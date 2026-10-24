import { containerAddress } from './container-address.mjs'
try {
  const response = await fetch(`http://${containerAddress()}:3093/`, { headers: { Host: '127.0.0.1:3093' }, redirect: 'manual', signal: AbortSignal.timeout(4000) })
  process.exitCode = [200, 303, 401].includes(response.status) ? 0 : 1
  await response.body?.cancel()
} catch { process.exitCode = 1 }
