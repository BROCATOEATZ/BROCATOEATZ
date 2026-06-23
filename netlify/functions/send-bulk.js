const twilio = require('twilio');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  const data = JSON.parse(event.body);
  const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);

  const recipients = data.recipients || [];

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
