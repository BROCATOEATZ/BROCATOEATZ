const twilio = require('twilio');
const { google } = require('googleapis');

const SHEET_ID = '1IWdUxnYtx-vth6Sy9heTWr9ui93zP6AD7U7JRCCpNbY';
const SHEET_RANGE = 'Sign Ups!A2:C'; // skips header row, columns: First Name, Last Name, Phone

// The exact date/time this scheduled alert should fire (Eastern Time).
// Update this value for future drops, or remove the date check entirely
// if you want this to fire on this same schedule every week.
const TARGET_DATE_ET = '2026-06-30'; // Tuesday, June 30 2026

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
    .filter(function (row) { return row && row[2]; })
    .map(function (row) {
      return {
        fname: row[0] || '',
        lname: row[1] || '',
        phone: row[2] || ''
      };
    });
}

function buildDropAlertMessage(fname) {
  const name = fname || 'Hey';
  return `Hey ${name}! 🍕\n\nFeature Pizza: Calabrian Heat\n\nOrders are open 15 minutes early for Drop List members — order now: brocatoeatz.com/?order\n\nThank you - Brocato`;
}

// Returns today's date in Eastern Time as 'YYYY-MM-DD', regardless of the
// server's own timezone (Netlify scheduled functions run in UTC).
function getTodayDateET() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit'
  });
  return formatter.format(new Date()); // en-CA gives YYYY-MM-DD format
}

exports.handler = async function () {
  const todayET = getTodayDateET();

  if (todayET !== TARGET_DATE_ET) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: 'Not the target date', todayET: todayET })
    };
  }

  let recipients;
  try {
    recipients = await getDropListFromSheet();
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: 'Failed to read Drop List sheet: ' + err.message })
    };
  }

  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  const results = await Promise.all(recipients.map(async function (r) {
    try {
      await client.messages.create({
        body: buildDropAlertMessage(r.fname),
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

exports.config = {
  schedule: '45 22 * * *' // runs every day at 22:45 UTC = 6:45 PM Eastern (EDT)
};
