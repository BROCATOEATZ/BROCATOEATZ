const twilio = require('twilio');
const { google } = require('googleapis');

const SHEET_ID = '1IWdUxnYtx-vth6Sy9heTWr9ui93zP6AD7U7JRCCpNbY';
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
    .filter(function (row) { return row && row[2]; })
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
      return `Hey ${fname}! 🍕\n\nFeature Pizza: Calabrian Heat\n\nOrders are open 15 minutes early for Drop List members — order now: brocatoeatz.com/?order\n\nThank you - Brocato`;
    }
    if (type === 'reminder') {
      const fname = r.fname || 'Hey';
      const slotLine = r.slot || '';
      return
