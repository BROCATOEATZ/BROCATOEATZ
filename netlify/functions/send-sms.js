const twilio = require('twilio');

exports.handler = async function(event) {
  if(event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  const orderLines = data.pizzas.map(p => p.name + ' x' + p.qty + ' — $' + (p.price * p.qty)).join('\n');
  const brownieLine = data.brownie > 0 ? '\nDubai Brownie x' + data.brownie + ' — ' + (data.freeBrownie ? 'FREE' : '$' + (data.brownie * 5)) : '';
  const slotLine = data.slotDisplay || data.slot;

  const message = `Hey ${data.fname}! Your BrocatoEatz order is confirmed 🍕\n\n${orderLines}${brownieLine}\n\nTotal: $${data.total} — due at pickup\nPickup: ${slotLine}, July 5th\nCash preferred · E-transfer available\n\nAddress will be sent the morning of July 5th. See you then!`;

  await client.messages.create({
    body: message,
    from: '+12897233561',
    to: '+1' + data.phone.replace(/\D/g, '')
  });

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
