// Tiny DOM helpers: element builder, confirm dialog, toast. No framework, CSP-friendly (no inline styles).

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

/** Replace an element's children, skipping null/false so they never show up as text. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

let toastTimer;
export function toast(message, { ms = 4500 } = {}) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    el.textContent = '';
  }, ms);
}

/**
 * Shows `form` in the shared <dialog>. The answer is taken from the form's submit event (the
 * button's value), with the dialog's close event as a fallback for Escape.
 * `answer(ok)` turns "ok pressed or not" into the resolved value.
 */
function runDialog(form, answer, { focus } = {}) {
  return new Promise((resolve) => {
    const dlg = document.getElementById('dialog');
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      resolve(answer(ok));
    };
    form.addEventListener('submit', (ev) => {
      if (ev.defaultPrevented) return;
      finish(!!ev.submitter && ev.submitter.value === 'ok');
    });
    dlg.replaceChildren(form);
    dlg.setAttribute('aria-labelledby', 'dialog-title');
    dlg.addEventListener('close', () => finish(dlg.returnValue === 'ok'), { once: true });
    dlg.returnValue = 'cancel';
    dlg.showModal();
    if (focus) focus.focus();
  });
}

/** Accessible confirm dialog (native <dialog>: focus trap, Escape to cancel). Resolves true/false. */
export function confirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false }) {
  const form = h('form', { method: 'dialog', class: 'dialog-body' },
    h('h2', { id: 'dialog-title' }, title),
    message ? h('p', {}, message) : null,
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'submit', value: 'cancel', class: 'btn' }, cancelLabel),
      h('button', { type: 'submit', value: 'ok', class: danger ? 'btn danger' : 'btn primary' }, confirmLabel),
    ),
  );
  return runDialog(form, (ok) => ok);
}

/** Small text prompt in the same dialog (used to name a saved meal). Resolves the text, or null. */
export function promptDialog({ title, label, value = '', confirmLabel = 'Save', placeholder = '' }) {
  const input = h('input', { id: 'dialog-input', type: 'text', value, placeholder, autocomplete: 'off', maxlength: '60' });
  const err = h('p', { class: 'error', role: 'alert' });
  const form = h('form', { method: 'dialog', class: 'dialog-body' },
    h('h2', { id: 'dialog-title' }, title),
    h('label', { for: 'dialog-input' }, label),
    input,
    err,
    h('div', { class: 'dialog-actions' },
      h('button', { type: 'submit', value: 'cancel', class: 'btn' }, 'Cancel'),
      h('button', { type: 'submit', value: 'ok', class: 'btn primary' }, confirmLabel),
    ),
  );
  // Registered before runDialog's listener, so an empty name can block the submit first.
  form.addEventListener('submit', (ev) => {
    if (ev.submitter && ev.submitter.value === 'ok' && !input.value.trim()) {
      ev.preventDefault();
      err.textContent = 'Please type a name.';
      input.setAttribute('aria-invalid', 'true');
      input.focus();
    }
  });
  return runDialog(form, (ok) => (ok ? input.value.trim() : null), { focus: input });
}
