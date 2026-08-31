(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LifeQuestDailyFormSubmission = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const FIELD_NAMES = Object.freeze([
    'sleep', 'water', 'exercise', 'study', 'expense', 'impulse', 'sugaryDrinks'
  ]);

  function read(form) {
    if (!form?.elements || typeof form.elements.namedItem !== 'function') {
      throw new TypeError('daily form is required');
    }
    const input = {};
    FIELD_NAMES.forEach(name => {
      const field = form.elements.namedItem(name);
      if (!field || typeof field.value === 'undefined') {
        throw new TypeError(`daily form field is missing: ${name}`);
      }
      input[name] = field.value;
    });
    return Object.freeze(input);
  }

  function bind(form, onSubmit) {
    if (!form?.addEventListener || typeof onSubmit !== 'function') {
      throw new TypeError('daily form and submit callback are required');
    }
    const listener = async event => {
      event.preventDefault();
      const submittedForm = event.currentTarget;
      const input = read(submittedForm);
      return onSubmit({ event, form: submittedForm, input });
    };
    form.addEventListener('submit', listener);
    return () => form.removeEventListener('submit', listener);
  }

  return Object.freeze({ FIELD_NAMES, read, bind });
});
