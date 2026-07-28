const twilio = require('twilio');
// How many texts to fire at once, and how long to pause between batches.
// Sending everything in one giant burst is what was breaking bulk sends —
// Twilio will "accept" the request (so the old code reported it as sent)
// even when the carrier silently drops it for looking like a spam blast.
// Small batches + a short pause between them keeps this looking like normal
// traffic and keeps us well under Netlify's function time limit.
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

      // Count non-brownie pizzas to determine free brownie eligibility
      const totalPizzas = (r.M || 0) + (r.CC || r['C & C'] || 0) + (r.F || 0) + (r.BC || 0);
      const brownieQty = r.DB || 0;
      const freeBrownie = totalPizzas >= 2 && brownieQty > 0;

      const pizzaMap = [
        ['Margherita',      r.M  || 0],
        ['Cup & Char',      r.CC || r['C & C'] || 0],
        ['FunGuy',          r.F  || 0],
        ['Pesto & Ricotta', r.BC || 0],
      ];
      const orderParts = pizzaMap
        .filter(([, qty]) => qty > 0)
        .map(([name, qty]) => `${name} x${qty}`);

      if (brownieQty > 0) {
        orderParts.push(freeBrownie
          ? `Dubai Brownie x${brownieQty} (1 free!)`
          : `Dubai Brownie x${brownieQty}`);
      }

      const orderLine = orderParts.join(', ');

      const totalLine = (r.total !== undefined && r.total !== null) ? `\nTotal: $${r.total}` : '';

      return `Hey ${fname}! Friendly reminder — your pizza pickup is tomorrow, August 2nd @ ${slotLine}.\n\n${orderLine}${totalLine}\n\n📍 King's Court Estate Winery & Vineyard\n2083 Seventh Street Louth, St. Catharines, ON L2R 6P9\n\nSee you soon! Text Michael @ 905-401-7804 with any questions.`;
    }

    // fallback generic message if an unknown type is passed
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
      // create() resolving only means Twilio *accepted* the message into its
      // queue, not that it was delivered. Log the sid + initial status so
      // failures that happen after acceptance are still traceable in the
      // Netlify function logs / Twilio console.
      console.log('SMS queued', { phone: r.phone, sid: msg.sid, status: msg.status });
      return { phone: r.phone, status: 'sent', sid: msg.sid };
    } catch (err) {
      // err.code / err.moreInfo are Twilio-specific and point straight at
      // the Twilio error reference page — log them so a future failure is
      // debuggable from the Netlify function logs instead of a guess.
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
