import { createHash } from 'node:crypto';

const sha512 = (s: string) => createHash('sha512').update(s).digest('hex');

/** PayU request hash: sha512(key|txnid|amount|productinfo|firstname|email|udf1..udf5||||||SALT). */
export function requestHash(f: Record<string, string>, salt: string) {
  const udf = [1, 2, 3, 4, 5].map((i) => f[`udf${i}`] ?? '');
  return sha512([f.key, f.txnid, f.amount, f.productinfo, f.firstname, f.email, ...udf, '', '', '', '', '', salt].join('|'));
}

/** PayU response (reverse) hash: sha512(SALT|status||||||udf5..udf1|email|firstname|productinfo|amount|txnid|key). */
export function responseHash(f: Record<string, string>, salt: string) {
  const udf = [5, 4, 3, 2, 1].map((i) => f[`udf${i}`] ?? '');
  return sha512([salt, f.status, '', '', '', '', '', ...udf, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join('|'));
}

export const rupees = (paise: number) => (paise / 100).toFixed(2);
export const paise = (amount: string) => Math.round(Number(amount) * 100);
