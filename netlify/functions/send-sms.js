const twilio = require('twilio');

// Retries a Twilio send a few times with a short backoff if it hits a
// transient/rate-limit style error (common when many customers submit
// orders within seconds of each other, e.g. right when pre-orders open or
// during a busy drop). Twilio error 20429 = too many requests, 63038 =
// channel throughput exceeded — both are worth retrying; anything else
// (bad number, etc.) fails immediately since retrying won't help.
const RETRYABLE_CODES = [20429, 63038];

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function sendWithRetry(client, params, label) {
  var attempts = 0;
  var maxAttempts = 3;
  var delayMs = 500;

  while (true) {
    attempts++;
    try {
      const msg = await client.messages.create(params);
      console.log('SMS sent', { label: label, to: params.to, sid: msg.sid, status: msg.status, attempts: attempts });
      return { success: true, sid: msg.sid };
    } catch (err) {
      var retryable = RETRYABLE_CODES.indexOf(err.code) !== -1;
      console.error('SMS attempt failed', { label: label, to: params.to, attempt: attempts, code: err.code, message: err.message, moreInfo: err.moreInfo });
      if (!retryable || attempts >= maxAttempts) {
        return { success: false, error: err.message, code: err.code };
      }
      await sleep(delayMs);
      delayMs *= 2; // back off a bit more each retry
    }
  }
}

exports.handler = async function(event) {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  // Drop List signup confirmation
  if(data.type === 'signup') {
    const fname = data.fname || 'Hey';
    const message = `Hey ${fname}! Thanks for signing up — you're on the BrocatoEatz Drop List 🍕\n\nWe'll text you when the next drop goes live.\n\nStay tuned — next drop is August 2nd at King's Court Estate Winery & Vineyard in St. Catharines.\n\nSave our number so you don't miss the drop 👇\nbrocatoeatz.com/brocatoeatz.vcf\n\nReply STOP to unsubscribe.`;

    const result = await sendWithRetry(client, {
      body: message,
      from: '+12897233561',
      to: '+1' + data.phone.replace(/\D/g, '')
    }, 'signup');

    return { statusCode: 200, body: JSON.stringify(result) };
  }

  // Order confirmation
  const orderLines = data.pizzas.map(p => p.name + ' x' + p.qty + ' — $' + (p.price * p.qty)).join('\n');

  let brownieLine = '';
  if(data.brownie > 0) {
    if(data.freeBrownie) {
      brownieLine = '\nDubai Brownie x1 — FREE';
      if(data.brownie > 1) {
        const extras = data.brownie - 1;
        brownieLine += '\nDubai Brownie x' + extras + ' (extra) — $' + (extras * 5);
      }
    } else {
      brownieLine = '\nDubai Brownie x' + data.brownie + ' — $' + (data.brownie * 5);
    }
  }

  const slotLine = data.slotDisplay || data.slot;

  const message = `Hey ${data.fname}! You're locked in for the Augist 16rh Pizza Drop 🍕\n\nPickup @ ${slotLine}\n\n${orderLines}${brownieLine}\n\nYour total is $${data.total}. Cash preferred.\n\n📍 King's Court Estate Winery & Vineyard\n2083 Seventh Street Louth, St. Catharines, ON L2R 6P9\n\nIf you can't make it or have any questions, please let me know ASAP so no pizzas go to waste!\nText Michael @ 905-401-7804\n\nSee you August 16th! 🍕`;

  const result = await sendWithRetry(client, {
    body: message,
    from: '+12897233561',
    to: '+1' + data.phone.replace(/\D/g, '')
  }, 'order');

  return { statusCode: 200, body: JSON.stringify(result) };
};
