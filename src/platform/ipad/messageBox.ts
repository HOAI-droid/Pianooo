// A plain in-page dialog standing in for Electron's dialog.showMessageBox.
export function showMessageBox(opts: {
  type?: string; buttons: string[]; defaultId?: number; cancelId?: number; message: string; detail?: string
}): Promise<{ response: number }> {
  return new Promise(resolve => {
    const overlay = document.createElement('div')
    overlay.style.cssText = 'position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.45);font-family:inherit'
    const box = document.createElement('div')
    box.style.cssText = 'max-width:420px;width:calc(100% - 48px);background:#1f2129;color:#eceef4;border-radius:14px;padding:20px 20px 14px;box-shadow:0 12px 40px rgba(0,0,0,.5)'
    const title = document.createElement('div')
    title.textContent = opts.message
    title.style.cssText = 'font-weight:600;font-size:16px;margin-bottom:8px'
    box.appendChild(title)
    if (opts.detail) {
      const detail = document.createElement('div')
      detail.textContent = opts.detail
      detail.style.cssText = 'font-size:14px;opacity:.8;margin-bottom:12px;white-space:pre-wrap'
      box.appendChild(detail)
    }
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap'
    opts.buttons.forEach((label, i) => {
      const b = document.createElement('button')
      b.textContent = label
      const primary = i === (opts.defaultId ?? 0)
      b.style.cssText = `min-height:44px;padding:0 16px;border-radius:10px;border:0;font-size:15px;${primary ? 'background:#5b7cfa;color:#fff' : 'background:#30333d;color:#eceef4'}`
      b.addEventListener('click', () => { overlay.remove(); resolve({ response: i }) })
      row.appendChild(b)
    })
    box.appendChild(row)
    overlay.appendChild(box)
    document.body.appendChild(overlay)
  })
}
