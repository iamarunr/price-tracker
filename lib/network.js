const dns = require('node:dns').promises;
const net = require('node:net');

function publicAddress(address) {
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) ||
      (a === 198 && [18, 19, 51].includes(b)) || (a === 203 && b === 0));
  }
  // Accept global unicast only, excluding documentation and special-use ranges.
  return net.isIP(address) === 6 && /^[23]/i.test(address) && !/^2001:(?:0:|db8:|2:|10:|20:)/i.test(address);
}

async function assertPublicUrl(input) {
  const url = new URL(input);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.port || /(^|\.)(localhost|local|internal)$/.test(url.hostname)) throw new Error('Only public store websites can be checked.');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(hostname) ? [{ address: hostname }] : await dns.lookup(hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error('Private or local network links cannot be checked.');
  return url;
}
module.exports = { assertPublicUrl, publicAddress };
