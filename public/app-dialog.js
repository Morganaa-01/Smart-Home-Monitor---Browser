// Small dialog helper that replaces window.alert and window.confirm.
// The look follows the AlertDialog of the Flet Studio gallery (Dialogs): title, text and the actions on the right.
// It uses the native <dialog> element, so the focus stays inside and Esc closes it without extra code.
window.AppDialog = (() => {
  // Opens a dialog and resolves with true for the confirm button.
  // Cancel, Esc and a click on the dark background all resolve with false.
  function open({ title, message, confirmText, cancelText = null }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "app-dialog";
      dialog.setAttribute("aria-labelledby", "appDialogTitle");

      // Every way of closing goes through finish(), so the promise is resolved exactly once.
      // We do not wait for the "close" event of the dialog, because it comes a bit later than the click.
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
      };

      // The texts are set with textContent, so nothing a user typed can become HTML.
      const body = document.createElement("div");
      body.className = "app-dialog-body";
      const heading = document.createElement("h2");
      heading.id = "appDialogTitle";
      heading.textContent = title;
      const text = document.createElement("p");
      text.textContent = message;
      const actions = document.createElement("div");
      actions.className = "app-dialog-actions";

      if (cancelText) {
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "button secondary";
        cancelButton.textContent = cancelText;
        cancelButton.addEventListener("click", () => finish(false));
        actions.append(cancelButton);
      }
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "button primary";
      confirmButton.textContent = confirmText;
      confirmButton.addEventListener("click", () => finish(true));
      actions.append(confirmButton);

      body.append(heading, text, actions);
      dialog.append(body);
      // The dialog element itself is only hit when the click lands on the dark background.
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) finish(false);
      });
      // Esc: the browser closes the dialog by itself, we only need to answer "no".
      dialog.addEventListener("cancel", () => finish(false));
      dialog.addEventListener("close", () => finish(false));

      document.body.append(dialog);
      dialog.showModal();
      confirmButton.focus();
    });
  }

  return {
    alert: (message, title = "Üzenet") => open({ title, message, confirmText: "Rendben" }).then(() => undefined),
    confirm: (message, { title = "Megerősítés", confirmText = "Igen", cancelText = "Mégse" } = {}) =>
      open({ title, message, confirmText, cancelText })
  };
})();
