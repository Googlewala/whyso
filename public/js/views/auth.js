import { api, setToken } from '../api.js';
import { h, field, toast } from '../ui.js';

/**
 * Full-screen sign in / sign up screen shown when there is no valid session.
 * `onAuthed` is called with the user once credentials are accepted.
 */
export function authView({ onAuthed, demoAvailable = false }) {
  let mode = 'login';

  const wrap = h('div', { class: 'auth-wrap' });
  const card = h('div', { class: 'auth-card' });
  const errorBox = h('div', { class: 'auth-error', style: 'display:none' });

  function showError(message, fields = {}) {
    errorBox.textContent = message;
    errorBox.style.display = message ? 'block' : 'none';
    for (const [name, msg] of Object.entries(fields || {})) {
      const input = card.querySelector(`[name="${name}"]`);
      if (input) {
        input.classList.add('invalid');
        const hint = input.closest('.field')?.querySelector('.field-error');
        if (hint) hint.textContent = msg;
      }
    }
  }

  function clearErrors() {
    errorBox.style.display = 'none';
    card.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
    card.querySelectorAll('.field-error').forEach((el) => { el.textContent = ''; });
  }

  function fieldWithError(label, input, hint) {
    return h('div', { class: 'field' },
      h('label', { text: label }),
      input,
      hint ? h('div', { class: 'tiny muted', text: hint }) : null,
      h('div', { class: 'field-error' }),
    );
  }

  async function submit(btn) {
    clearErrors();
    const form = new FormData(card.querySelector('form'));
    const payload = Object.fromEntries(form.entries());
    btn.disabled = true;
    const label = btn.textContent;
    btn.textContent = 'Please wait…';
    try {
      const res = mode === 'login'
        ? await api.login({ email: payload.email, password: payload.password })
        : await api.signup({ name: payload.name, email: payload.email, password: payload.password, vpa: payload.vpa || null });
      setToken(res.token);
      onAuthed(res.user);
    } catch (err) {
      showError(err.message, err.fields);
      btn.disabled = false;
      btn.textContent = label;
    }
  }

  function render() {
    card.replaceChildren();
    clearErrors();

    const isLogin = mode === 'login';
    const nameInput = h('input', { name: 'name', type: 'text', placeholder: 'Aarav Mehta', autocomplete: 'name' });
    const emailInput = h('input', { name: 'email', type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true });
    const passwordInput = h('input', { name: 'password', type: 'password', placeholder: isLogin ? 'Your password' : 'At least 8 characters', autocomplete: isLogin ? 'current-password' : 'new-password', required: true });
    const vpaInput = h('input', { name: 'vpa', type: 'text', placeholder: 'you@okhdfcbank (optional)', autocomplete: 'off' });

    const submitBtn = h('button', { class: 'btn btn-primary auth-submit', type: 'submit', text: isLogin ? 'Sign in' : 'Create account' });

    const form = h('form', { onsubmit: (e) => { e.preventDefault(); submit(submitBtn); } },
      isLogin ? null : fieldWithError('Name', nameInput),
      fieldWithError('Email', emailInput),
      fieldWithError('Password', passwordInput),
      isLogin ? null : fieldWithError('UPI ID', vpaInput, 'Used for pay links and settlements. You can add it later.'),
      submitBtn,
    );

    card.append(
      h('div', { class: 'auth-brand' },
        h('div', { class: 'brand-mark big' }, '₹'),
        h('div', {},
          h('div', { class: 'brand-name', text: 'Whyso' }),
          h('div', { class: 'brand-tag', text: 'UPI-aware expense manager' }),
        ),
      ),
      h('h2', { class: 'auth-title', text: isLogin ? 'Welcome back' : 'Create your account' }),
      h('p', { class: 'auth-sub muted', text: isLogin
        ? 'Sign in to scan UPI QRs, split bills and export statements.'
        : 'Track UPI spending, split with groups and export PDF statements.' }),
      errorBox,
      form,
      demoAvailable ? h('button', {
        class: 'btn auth-demo',
        text: '🎬 Explore the demo workspace',
        onclick: async () => {
          try {
            const res = await api.demoLogin();
            setToken(res.token);
            onAuthed(res.user);
          } catch (err) { showError(err.message); }
        },
      }) : null,
      h('div', { class: 'auth-switch' },
        h('span', { class: 'muted', text: isLogin ? 'New to Whyso? ' : 'Already have an account? ' }),
        h('a', { href: '#', text: isLogin ? 'Create an account' : 'Sign in', onclick: (e) => { e.preventDefault(); mode = isLogin ? 'signup' : 'login'; render(); } }),
      ),
    );
    const first = card.querySelector('input');
    first?.focus();
  }

  render();
  wrap.append(h('div', { class: 'auth-bg' }), card);
  return wrap;
}

/** Small reusable error surface for quota/upgrade responses. */
export function upgradeNotice(err, onUpgrade) {
  return h('div', { class: 'notice upgrade' },
    h('span', { class: 'em', text: '⭐' }),
    h('div', {},
      h('div', { style: 'font-weight:650', text: err.message }),
      h('div', { class: 'tiny muted', text: 'Upgrade to Pro for unlimited usage.' }),
    ),
    onUpgrade ? h('button', { class: 'btn btn-primary btn-sm', text: 'See plans', onclick: onUpgrade }) : null,
  );
}

export function toastError(err, onUpgrade) {
  if (err?.upgrade) toast(`⭐ ${err.message}`, 'warn');
  else toast(err?.message || 'Something went wrong', 'error');
}
