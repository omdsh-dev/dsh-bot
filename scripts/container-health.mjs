try {
  const response = await fetch(`http://127.0.0.1:${process.env.DSH_BOT_PORT || '3093'}/`, { redirect: 'manual', signal: AbortSignal.timeout(4000) })
  process.exitCode = [200, 303, 401].includes(response.status) ? 0 : 1
  await response.body?.cancel()
} catch { process.exitCode = 1 }
