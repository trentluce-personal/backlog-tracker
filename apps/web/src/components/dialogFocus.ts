export function dialogControls(dialog: HTMLDialogElement) {
  return [...dialog.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], summary, [tabindex]')]
    .filter(element => !element.matches(':disabled') && element.tabIndex >= 0
      && !element.closest('[hidden], [inert]') && element.getClientRects().length > 0
      && getComputedStyle(element).visibility !== 'hidden'
      && [...dialog.querySelectorAll('details:not([open])')].every(details =>
        !details.contains(element) || details.querySelector(':scope > summary')?.contains(element)));
}
