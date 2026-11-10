// Kis párbeszédablak-segéd, ami a böngésző saját window.alert és window.confirm ablakát váltja ki.
// A megjelenése a Flet Studio galéria AlertDialog mintáját követi: cím, szöveg, jobbra a gombok.
// A natív <dialog> elemet használja, ezért a fókusz az ablakban marad, az Esc pedig külön kód nélkül bezárja.
window.AppDialog = (() => {
  // Megnyit egy párbeszédablakot, és egy Promise-t ad vissza: true, ha a megerősítő gombra kattintottak.
  // A Mégse gomb, az Esc és a sötét háttérre kattintás is false értéket ad.
  function open({ title, message, confirmText, cancelText = null }) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.className = "app-dialog";
      dialog.setAttribute("aria-labelledby", "appDialogTitle");

      // Minden bezárási mód a finish() függvényen megy át, így az ígéret (Promise) pontosan egyszer teljesül.
      // Nem várjuk meg az ablak 'close' eseményét, mert az kicsit később jön, mint a kattintás.
      let finished = false;
      const finish = (value) => {
        if (finished) return;
        finished = true;
        if (dialog.open) dialog.close();
        dialog.remove();
        resolve(value);
      };

      // A szövegeket textContent-tel állítjuk be, így amit a felhasználó beírt, soha nem válhat HTML-lé.
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
      // Magát a dialog elemet csak akkor találja el a kattintás, ha a sötét háttérre kattintottak.
      dialog.addEventListener("click", (event) => {
        if (event.target === dialog) finish(false);
      });
      // Esc: az ablakot a böngésző zárja be, nekünk csak a 'nem' választ kell megadnunk.
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
