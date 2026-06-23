const twilio = require('twilio');
const { google } = require('googleapis');

const SHEET_ID = '1qOA7JuqiG7pmF9j8z0eLMsVWj3V8-OeQ4uWD3q_wuSQ';
const SHEET_RANGE = 'Sign Ups!A2:C'; // skips header row, columns: First Name, Last Name, Phone

async function getDropListFromSheet() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
  });

  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: SHEET_RANGE
  });

  const rows = res.data.values || [];

  return rows
    .filter(function (row) { return row && row[2]; }) // must have a phone number
    .map(function (row) {
      return {
        fname: row[0] || '',
        lname: row[1] || '',
        phone: row[2] || ''
      };
    });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  function buildMessage(type, r) {
    if (type === 'drop_alert') {
      const fname = r.fname || 'Hey';
      return `Hey ${fname}! 🍕 Feature Pizza: Calabrian Heat. Orders are open 15 minutes early for Drop List members — order now: brocatoeatz.com/?order\n\nThank you - Brocato`;
    }
    if (type === 'reminder') {
      const fname = r.fname || 'Hey';
      const slotLine = r.slot || '';
      return `Hey ${fname}! Friendly reminder — your pizza pickup is coming up${slotLine ? ' @ ' + slotLine : ''}.\n\nSee you soon! Text Michael @ 905-401-7804 with any questions.`;
    }
    // fallback generic message if an unknown type is passed
    return `Hey ${r.fname || 'there'}! This is a message from BrocatoEatz.`;
  }

  // Use recipients passed in the request if provided (e.g. for reminders, which
  // come from order data, not the Drop List sheet). Otherwise, for drop_alert,
  // pull the live list straight from the Google Sheet.
  let recipients = data.recipients || [];

  if (data.type === 'drop_alert' && recipients.length === 0) {
    try {
      recipients = await getDropListFromSheet();
    } catch (err) {
      return {
        statusCode: 500,
        body: JSON.stringify({ success: false, error: 'Failed to read Drop List sheet: ' + err.message })
      };
    }
  }

  const results = await Promise.all(recipients.map(async function (r) {
    try {
      const message = buildMessage(data.type, r);
      await client.messages.create({
        body: message,
        from: '+12897233561',
        to: '+1' + String(r.phone || '').replace(/\D/g, '')
      });
      return { phone: r.phone, status: 'sent' };
    } catch (err) {
      return { phone: r.phone, status: 'failed', error: err.message };
    }
  }));

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, results: results })
  };
};
