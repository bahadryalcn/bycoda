// The member composer is a native `dialog[open]`. Hashed classes and `data-view-name` attributes come
// and go between LinkedIn front-end variants, so controls are found by role, state and (EN/TR) label.
export const LINKEDIN_COMPOSER_EDITOR = 'dialog[open] [role="textbox"][contenteditable="true"]';
export const LINKEDIN_POST_LABELS = ["Post", "Yayınla"] as const;
/** The file input is built on click and would open a native chooser; park it in the page instead. */
export const LINKEDIN_CAPTURE_FILE_INPUT = String.raw`(() => {
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') return click.call(this);
    document.querySelectorAll('[data-bycoda-li-file]').forEach(el => el.removeAttribute('data-bycoda-li-file'));
    this.setAttribute('data-bycoda-li-file', 'true');
  };
  return true;
})()`;
