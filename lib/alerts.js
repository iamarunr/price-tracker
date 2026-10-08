function emailConfigured(config) {
  return Boolean(config.resendApiKey && !config.resendApiKey.includes('your_') && config.fromEmail && config.toEmail && !config.toEmail.endsWith('@example.com'));
}

async function sendAlertEmail(resend, config, product, price) {
  const currency = product.currency || product.history?.at(-1)?.currency || 'USD';
  const amount = value => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  const response = await resend.emails.send({
    from: config.fromEmail,
    to: config.toEmail,
    subject: `Price drop: ${product.name} — ${amount(price)}`,
    text: `${product.name}\n\nCurrent price: ${amount(price)}\nAlert target: ${amount(product.priceThreshold)}\nBelow target by: ${amount(product.priceThreshold - price)}\n\n${product.url}`
  });
  if (response?.error || !response?.data?.id) throw new Error(response?.error?.message || 'Email service did not confirm acceptance.');
  return response.data.id;
}

async function maybeAlert({ product, price, config, previous, dryRun = false, send }) {
  if (!(product.priceThreshold > 0 && price < product.priceThreshold) || (previous && price >= previous.price)) return null;
  if (dryRun) return { dryRun: true };
  if (!emailConfigured(config)) return null;
  const deliveryId = await send(product, price);
  return { price, alertedAt: new Date().toISOString(), deliveryId };
}

module.exports = { emailConfigured, sendAlertEmail, maybeAlert };
