const twilio = require('twilio');

const BATCH_SIZE = 8;
const BATCH_DELAY_MS = 300;

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
  const recipients = data.recipients || [];

  function buildMessage(type, r) {
    if (type === 'custom') {
      const fname = r.fname || 'there';
      const body = String(data.message || '').replace(/\{name\}/g, fname);
      return `${body}\n\nReply STOP to opt out.`;
    }
    if (type === 'reminder') {
      const fname = r.fname || 'Hey';
      const slotLine = r.slot || 'TBD';
      const totalLine = (r.total !== undefined && r.total !== null) ? `\nTotal: $${r.total}` : '';
      return `Hey ${fname}! Friendly reminder — your pizza pickup is tomorrow, August 23rd @ ${slotLine}.${totalLine}\n\n📍 King's Court Estate Winery & Vineyard\n2083 Seventh Street Louth, St. Catharines, ON L2R 6P9\n\n🍷 We've set up tables inside the winery's processing room as its calling for rain again.\n\nSee you soon! Text Michael @ 905-401-7804 with any questions.`;
    }
    return `Hey ${r.fname || 'there'}! This is a message from BrocatoEatz.`;
  }

  async function sendOne(r) {
    try {
      const message = buildMessage(data.type, r);
      const msg = await client.messages.create({
        body: message,
        from: '+12897233561',
        to: '+1' + String(r.phone || '').replace(/\D/g, '')
      });
      console.log('SMS queued', { phone: r.phone, sid: msg.sid, status: msg.status });
      return { phone: r.phone, status: 'sent', sid: msg.sid };
    } catch (err) {
      console.error('SMS failed', { phone: r.phone, code: err.code, message: err.message, moreInfo: err.moreInfo });
      return { phone: r.phone, status: 'failed', error: err.message, code: err.code };
    }
  }

  const results = [];
  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(sendOne));
    results.push.apply(results, batchResults);
    if (i + BATCH_SIZE < recipients.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  const failed = results.filter(function (r) { return r.status === 'failed'; });
  if (failed.length) {
    console.error('Bulk send finished with failures', failed);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true, results: results })
  };
};
