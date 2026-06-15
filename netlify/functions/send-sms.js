const twilio = require('twilio');

exports.handler = async function(event) {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  // Drop List signup confirmation
  if(data.type === 'signup') {
    const message = `You're on the BrocatoEatz Drop List! 🍕\n\nYou'll get early access to pre-orders before anyone else.\n\nStay tuned — next drop is July 5th in St. Catharines.\n\nText Michael @ 905-401-7804 with any questions!`;
    await client.messages.create({
      body: message,
      from: '+12897233561',
      to: '+1' + data.phone.replace(/\D/g, '')
    });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
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

  const message = `Hey ${data.fname}! You're locked in for the July 5th Pizza Drop 🍕\n\nPickup @ ${slotLine}\n\n${orderLines}${brownieLine}\n\nYour total is $${data.total}. Cash preferred · E-transfer available.\n\n📍 33 McCaffery Cres, St. Catharines ON L2S 3Z5\nRIGHT SIDE GATE\n\nIf you can't make it or have any questions, please let me know ASAP so no pizzas go to waste!\nText Michael @ 905-401-7804\n\nSee you July 5th! 🍕`;

  await client.messages.create({
    body: message,
    from: '+12897233561',
    to: '+1' + data.phone.replace(/\D/g, '')
  });

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
