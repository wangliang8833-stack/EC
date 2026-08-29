const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { app, BrowserWindow, ipcMain } = require('electron')

const dataArgument = process.argv.find((argument) => argument.startsWith('--data='))?.slice('--data='.length)
const preloadArgument = process.argv.find((argument) => argument.startsWith('--preload='))?.slice('--preload='.length)
const outcome = process.argv.find((argument) => argument.startsWith('--outcome='))?.slice('--outcome='.length) ?? 'captcha'
const enableSubframes = process.argv.includes('--subframes')
if (!dataArgument || !preloadArgument) throw new Error('Usage: electron probe-account-login-preload.cjs --data=<path> --preload=<path>')
if (outcome !== 'captcha' && outcome !== 'error') throw new Error('Outcome must be captcha or error')

const probeRoot = resolve(dataArgument)
mkdirSync(probeRoot, { recursive: true })
app.setPath('userData', probeRoot)
app.setPath('sessionData', probeRoot)

async function main() {
  await app.whenReady()
  const statuses = []
  ipcMain.on('account-login-automation:status', (_event, status) => statuses.push(status))
  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: resolve(preloadArgument),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: enableSubframes
    }
  })
  const frameHtml = `<!doctype html><html><body>
    <form id="login-form">
      <input id="fm-login-id" name="fm-login-id" type="text">
      <input id="fm-login-password" name="fm-login-password" type="password">
      <button type="submit">登录</button>
    </form>
    <script>
      window.submitCount = 0;
      document.getElementById('login-form').addEventListener('submit', (event) => {
        event.preventDefault();
        window.submitCount += 1;
        const feedback = document.createElement('div');
        feedback.className = ${JSON.stringify(outcome === 'captcha' ? 'captcha-container' : 'login-error')};
        feedback.style.cssText = 'width:240px;height:80px;display:block';
        feedback.textContent = ${JSON.stringify(outcome === 'captcha' ? 'captcha challenge' : 'incorrect password')};
        document.body.appendChild(feedback);
      });
    <\/script>
  </body></html>`
  const encodedFrame = Buffer.from(frameHtml, 'utf8').toString('base64')
  const html = `<!doctype html><html><body><iframe id="login-frame" style="width:500px;height:500px"></iframe><script>document.querySelector('#login-frame').srcdoc = atob('${encodedFrame}')<\/script></body></html>`
  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 250))
  const loginFrame = window.webContents.mainFrame.framesInSubtree.find((frame) => frame !== window.webContents.mainFrame)
  if (!loginFrame) throw new Error('Login iframe was not created')
  loginFrame.send('account-login-automation:credentials', {
    username: 'fixture-user',
    password: 'fixture-password'
  })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_500))
  const page = await loginFrame.executeJavaScript(`({
    usernameFilled: document.querySelector('#fm-login-id').value === 'fixture-user',
    passwordFilled: document.querySelector('#fm-login-password').value === 'fixture-password',
    submitCount: window.submitCount,
    feedbackText: document.querySelector('.captcha-container, .login-error')?.textContent ?? null
  })`)
  writeFileSync(resolve(probeRoot, 'result.json'), JSON.stringify({ ...page, statuses }, null, 2), 'utf8')
  app.exit(0)
}

main().catch((error) => {
  writeFileSync(resolve(probeRoot, 'error.txt'), String(error?.stack ?? error), 'utf8')
  app.exit(1)
})
