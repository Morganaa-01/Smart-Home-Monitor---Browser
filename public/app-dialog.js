// Egyszerű párbeszédablak a böngésző alert és confirm ablaka helyett.
// A natív <dialog> elemet használjuk, ezért a fókusz az ablakban marad, az Esc pedig magától bezárja.
window.AppDialog = (() => {
  // Megnyit egy ablakot, és Promise-t ad vissza: true, ha a megerősítő gombra kattintottak.
  // Mégse, Esc vagy a háttérre kattintás esetén false.
  function open({ title, message, confirmText, cancelText = null }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "app-dialog";
      dialog.setAttribute("aria-labelledby", "appDialogTitle");

      // Minden bezárás a finish()-en megy át, így a Promise csak egyszer teljesül.
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
      };

      // A szöveget textContent-tel állítjuk be, így nem lehet belőle HTML.
      const body = document.createElement("div");
      body.className = "app-dialog-body";
      const heading = document.createElement("h2");
      heading.id = "appDialogTitle";
      heading.className = "h3";
      heading.textContent = title;
      const text = document.createElement("p");
      text.textContent = message;
      const actions = document.createElement("div");
      actions.className = "app-dialog-actions mt-4";

      if (cancelText) {
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.className = "btn";
        cancelButton.textContent = cancelText;
        cancelButton.addEventListener("click", () => finish(false));
        actions.append(cancelButton);
      }
      const confirmButton = document.createElement("button");
      confirmButton.type = "button";
      confirmButton.className = "btn btn-primary";
      confirmButton.textContent = confirmText;
      confirmButton.addEventListener("click", () => finish(true));
      actions.append(confirmButton);

      body.append(heading, text, actions);
      dialog.append(body);
      // A dialog elemre kattintás = a háttérre kattintottak.
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) finish(false);
      });
      // Esc: a böngésző zárja be, nekünk csak a 'nem' választ kell visszaadni.
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
