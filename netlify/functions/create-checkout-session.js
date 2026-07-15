// netlify/functions/create-checkout-session.js
//
// Creates a Stripe Checkout Session server-side using the secret key
// stored in the Netlify environment variable "songwriters_key".
// The browser never sees the secret key -- it only gets back a
// session URL to redirect to.

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" })
    };
  }

  const secretKey = process.env.songwriters_key;

  if (!secretKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Server is missing the Stripe secret key." })
    };
  }

  let priceId;
  try {
    const body = JSON.parse(event.body || "{}");
    priceId = body.priceId;
  } catch (err) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid request body." })
    };
  }

  if (!priceId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing priceId." })
    };
  }

  const origin =
    event.headers.origin ||
    `https://${event.headers.host}`;

  const params = new URLSearchParams();
  params.append("mode", "payment");
  params.append("line_items[0][price]", priceId);
  params.append("line_items[0][quantity]", "1");
  params.append("success_url", `${origin}/success/index.html`);
  params.append("cancel_url", `${origin}/`);

  try {
    const stripeRes = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const session = await stripeRes.json();

    if (!stripeRes.ok) {
      return {
        statusCode: stripeRes.status,
        body: JSON.stringify({ error: session.error ? session.error.message : "Stripe request failed." })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ url: session.url })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected server error creating checkout session." })
    };
  }
};
