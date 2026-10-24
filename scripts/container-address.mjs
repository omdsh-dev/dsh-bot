import { networkInterfaces } from 'node:os'
/** Bind the container's concrete private interface through DSH's supported --host option. */
export function containerAddress() {
  const addresses = Object.values(networkInterfaces()).flat().filter(item => item && item.family === 'IPv4' && !item.internal)
  const address = addresses.find(item => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(item.address))?.address
  if (!address) throw new Error('No private container interface found; use the supplied Docker bridge configuration.')
  return address
}
