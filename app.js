(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const caption = document.getElementById('animation-caption');
  const index = document.getElementById('animation-index');
  const stages = [
    { at: 0, label: 'Getting things in order' },
    { at: 1050, label: 'Opening the folder' },
    { at: 1650, label: 'Basic, Standard, Enhanced' },
    { at: 3150, label: 'Checking the details' },
    { at: 5700, label: 'A clear set of next steps' }
  ];
  if (reducedMotion) {
    caption.textContent = 'Three check levels, clearly set out'; index.textContent = '01 / 01';
  } else {
    const start = performance.now();
    const tick = now => {
      const elapsed = now - start;
      let current = 0;
      stages.forEach((stage, i) => { if (elapsed >= stage.at) current = i; });
      caption.textContent = stages[current].label;
      index.textContent = `${String(current + 1).padStart(2, '0')} / 05`;
      if (elapsed < 7000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const menuButton = document.querySelector('.menu-toggle');
  const nav = document.getElementById('main-nav');
  menuButton.addEventListener('click', () => {
    const open = menuButton.getAttribute('aria-expanded') !== 'true';
    menuButton.setAttribute('aria-expanded', String(open));
    nav.classList.toggle('open', open);
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
    nav.classList.remove('open'); menuButton.setAttribute('aria-expanded', 'false');
  }));

  const reveals = document.querySelectorAll('.reveal');
  const progress = document.getElementById('progress-fill');
  const steps = document.getElementById('steps');
  const processVisual = document.querySelector('.process-folder');
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: 0.18 });
    reveals.forEach(el => observer.observe(el));
    const processObserver = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const update = () => {
        const rect = steps.getBoundingClientRect();
        const vh = window.innerHeight;
        const total = rect.height;
        const progressPx = Math.max(0, Math.min(total, (vh * 0.68) - rect.top));
        progress.style.height = `${(progressPx / total) * 100}%`;
        if (!reducedMotion && processVisual) {
          const center = rect.top + total / 2;
          const offset = Math.max(-13, Math.min(13, (vh * 0.55 - center) * .035));
          processVisual.style.transform = `translate3d(0, ${offset}px, 0) rotate(-8deg)`;
        }
      };
      update(); window.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);
      processObserver.unobserve(entry.target);
    }), { threshold: 0.01 });
    processObserver.observe(steps);
  } else {
    reveals.forEach(el => el.classList.add('is-visible'));
    progress.style.height = '100%';
  }

  const form = document.getElementById('enquiry-form');
  const submit = document.getElementById('submit-button');
  const status = document.getElementById('form-status');
  const validEmail = value => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
  function setError(name, message) {
    const target = form.querySelector(`[data-error="${name}"]`);
    if (target) target.textContent = message;
    const control = form.elements[name];
    if (control) control.setAttribute('aria-invalid', message ? 'true' : 'false');
  }
  function validate() {
    const data = new FormData(form);
    const checks = {
      name: String(data.get('name') || '').trim().length >= 2 ? '' : 'Please enter your name.',
      email: validEmail(String(data.get('email') || '').trim()) ? '' : 'Enter a valid email address.',
      checkType: data.get('checkType') ? '' : 'Please choose an option.',
      message: String(data.get('message') || '').trim().length >= 10 ? '' : 'Please add at least 10 characters.',
      consent: data.get('consent') ? '' : 'Please confirm you agree to be contacted.'
    };
    Object.entries(checks).forEach(([name, error]) => setError(name, error));
    const first = Object.keys(checks).find(name => checks[name]);
    if (first) form.elements[first].focus();
    return !first;
  }
  form.querySelectorAll('input,select,textarea').forEach(control => control.addEventListener('input', () => {
    const error = form.querySelector(`[data-error="${control.name}"]`);
    if (error && error.textContent) setError(control.name, '');
  }));
  fetch('/api/content').then(r => r.ok ? r.json() : Promise.reject()).then(content => {
    const home = (content.pages || []).find(page => page.slug === 'home');
    if (home) {
      document.title = `${home.title.replace('|', ' ')} — DBS Express`;
      const h1 = document.querySelector('.hero h1');
      if (home.title) {
        h1.replaceChildren();
        const parts = home.title.split('|', 2);
        h1.append(document.createTextNode(parts[0]));
        if (parts[1]) { h1.append(document.createElement('br')); const em = document.createElement('em'); em.textContent = parts[1]; h1.append(em); }
      }
      if (home.body) document.querySelector('.hero .lead').textContent = home.body;
    }
    if (content.faqs?.length) {
      const list = document.querySelector('.faq-list'); list.replaceChildren();
      content.faqs.forEach(faq => {
        const details = document.createElement('details'); const summary = document.createElement('summary');
        summary.append(document.createTextNode(faq.question)); const toggle = document.createElement('span'); summary.append(toggle);
        const answer = document.createElement('p'); answer.textContent = faq.answer; details.append(summary, answer); list.append(details);
      });
    }
  }).catch(() => {});

  form.addEventListener('submit', async event => {
    event.preventDefault();
    status.className = 'form-status'; status.textContent = '';
    if (!validate()) return;
    const data = Object.fromEntries(new FormData(form).entries());
    data.consent = Boolean(data.consent);
    data.requestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    submit.disabled = true; submit.setAttribute('aria-busy', 'true');
    status.className = 'form-status pending'; status.textContent = 'Sending your enquiry…';
    try {
      const response = await fetch('/api/enquiries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.message || 'We could not submit your enquiry. Please try again later.');
      if (result.notification === 'failed') {
        status.className = 'form-status error';
        status.textContent = 'Your enquiry was saved, but the email notification could not be sent. Please contact the team directly to make sure they see it.';
      } else if (result.notification === 'pending') {
        status.className = 'form-status error';
        status.textContent = 'Your enquiry was saved, but the email notification status could not be confirmed. Please contact the team directly to make sure they see it.';
      } else {
        status.className = 'form-status';
        status.textContent = 'Thank you. Your enquiry has been received.';
        form.reset();
      }
    } catch (error) {
      status.className = 'form-status error';
      status.textContent = error.message || 'We could not submit your enquiry. Please try again later.';
    } finally { submit.disabled = false; submit.removeAttribute('aria-busy'); }
  });
})();
