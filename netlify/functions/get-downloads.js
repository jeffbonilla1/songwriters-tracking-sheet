// netlify/functions/get-downloads.js
//
// Hands out paid templates ONLY after confirming with Stripe that the
// checkout session was paid, and only the templates that session bought.
//
//   GET /.netlify/functions/get-downloads?session_id=cs_...           -> list of files this buyer owns
//   GET /.netlify/functions/get-downloads?session_id=cs_...&file=sales -> the file itself (download)
//
// The paid template files live in /private-templates (blocked from the public
// site in netlify.toml) and are bundled into this function via included_files.

const fs = require("fs");
const path = require("path");

const TEMPLATES = {
  sales:      { file: "sales-ledger.html",      name: "Digital Distribution Sales",           desc: "Streams, downloads, top countries, month-over-month trend" },
  publishing: { file: "publishing-ledger.html", name: "Mechanical & Publishing Royalties",    desc: "Society payments split by mechanical vs. performance, by territory" },
  licensing:  { file: "licensing-ledger.html",  name: "Social Video Monetization Earnings",   desc: "Content ID and cover song money broken down by platform and track" },
  account:    { file: "account-ledger.html",    name: "Lifetime Account Transactions",        desc: "Every sale, payout, and fee since day one. Flags missing payments." }
};

// Stripe Price ID -> which templates it unlocks
const PRICE_TO_TEMPLATES = {
  "price_1TtDnbGnyZ8MOYxKcVOMgZg6": ["sales"],
  "price_1TtDoiGnyZ8MOYxKXOcq3NNO": ["publishing"],
  "price_1TtDpdGnyZ8MOYxK1VAkQNqU": ["licensing"],
  "price_1TtDqSGnyZ8MOYxKCklNJ4Hz": ["account"],
  "price_1TtDrNGnyZ8MOYxKvoY6eOba": ["sales", "publishing", "licensing", "account"] // Songwriter Bundle
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(obj) };
}

function readTemplate(fileName) {
  const candidates = [
    path.join(process.cwd(), "private-templates", fileName),
    path.join(__dirname, "private-templates", fileName),
    path.join(__dirname, "..", "..", "private-templates", fileName),
    path.join(process.env.LAMBDA_TASK_ROOT || "", "private-templates", fileName)
  ];
  for (const p of candidates) {
    try { if (fs.existsSync(p)) return fs.readFileSync(p, "utf8"); } catch (e) {}
  }
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== "GET") return json(405, { error: "Method not allowed" });

  const secretKey = process.env.songwriters_key;
  if (!secretKey) return json(500, { error: "Server is missing the Stripe secret key." });

  const q = event.queryStringParameters || {};
  const sessionId = q.session_id || "";
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) {
    return json(400, { error: "Missing or invalid purchase reference." });
  }

  let session;
  try {
    const res = await fetch(
      `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
      { headers: { Authorization: `Bearer ${secretKey}` } }
    );
    session = await res.json();
    if (!res.ok) return json(404, { error: "We couldn't find that purchase." });
  } catch (e) {
    return json(502, { error: "Couldn't reach the payment system. Please try again." });
  }

  if (session.payment_status !== "paid") {
    return json(402, { error: "This purchase hasn't been completed." });
  }

  const owned = new Set();
  const items = (session.line_items && session.line_items.data) || [];
  for (const li of items) {
    const priceId = li.price && li.price.id;
    (PRICE_TO_TEMPLATES[priceId] || []).forEach((k) => owned.add(k));
  }
  if (owned.size === 0) return json(404, { error: "No templates are attached to this purchase." });

  // No file requested: return the list this buyer owns.
  if (!q.file) {
    return json(200, {
      files: [...owned].map((k) => ({ key: k, name: TEMPLATES[k].name, desc: TEMPLATES[k].desc, file: TEMPLATES[k].file }))
    });
  }

  // File requested: must be one they own.
  const key = q.file;
  if (!TEMPLATES[key] || !owned.has(key)) return json(403, { error: "That template isn't part of this purchase." });

  const content = readTemplate(TEMPLATES[key].file);
  if (content === null) return json(500, { error: "Template file is missing on the server. Please contact support." });

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${TEMPLATES[key].file}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex"
    },
    body: content
  };
};
