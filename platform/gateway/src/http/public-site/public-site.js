(() => {
  const openButtons = document.querySelectorAll(".js-request-demo");
  const overlay = document.getElementById("demoOverlay");
  const closeButton = document.getElementById("demoClose");
  const form = document.getElementById("demoForm");
  const submitButton = document.getElementById("demoSubmit");
  const confirmation = document.getElementById("demoConfirmation");

  if (!overlay || !form || !submitButton) return;

  const inputs = {
    fullName: document.getElementById("demoFullName"),
    workEmail: document.getElementById("demoWorkEmail"),
    company: document.getElementById("demoCompany"),
    message: document.getElementById("demoMessage")
  };

  const errors = {
    fullName: document.getElementById("errorFullName"),
    workEmail: document.getElementById("errorWorkEmail"),
    company: document.getElementById("errorCompany"),
    message: document.getElementById("errorMessage")
  };

  const focusableSelector =
    'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])';
  let lastFocused = null;

  const getCookie = (name) => {
    const value = document.cookie
      .split(";")
      .map((cookie) => cookie.trim())
      .find((cookie) => cookie.startsWith(`${name}=`));
    if (!value) return "";
    return decodeURIComponent(value.split("=").slice(1).join("="));
  };

  const setError = (input, errorEl, message) => {
    if (!input || !errorEl) return;
    errorEl.textContent = message;
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  };

  const clearErrors = () => {
    setError(inputs.fullName, errors.fullName, "");
    setError(inputs.workEmail, errors.workEmail, "");
    setError(inputs.company, errors.company, "");
    setError(inputs.message, errors.message, "");
  };

  const validate = () => {
    clearErrors();
    let valid = true;
    const fullName = inputs.fullName?.value.trim() ?? "";
    const workEmail = inputs.workEmail?.value.trim() ?? "";
    const company = inputs.company?.value.trim() ?? "";

    if (!fullName) {
      setError(inputs.fullName, errors.fullName, "Required");
      valid = false;
    }
    if (!workEmail) {
      setError(inputs.workEmail, errors.workEmail, "Required");
      valid = false;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(workEmail)) {
      setError(inputs.workEmail, errors.workEmail, "Enter a valid email");
      valid = false;
    }
    if (!company) {
      setError(inputs.company, errors.company, "Required");
      valid = false;
    }

    return valid;
  };

  const openModal = () => {
    lastFocused = document.activeElement;
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    clearErrors();
    if (confirmation) confirmation.hidden = true;
    const firstInput = overlay.querySelector(focusableSelector);
    if (firstInput) firstInput.focus();
  };

  const closeModal = () => {
    overlay.hidden = true;
    document.body.style.overflow = "";
    if (lastFocused && typeof lastFocused.focus === "function") {
      lastFocused.focus();
    }
  };

  const handleKeydown = (event) => {
    if (overlay.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = Array.from(overlay.querySelectorAll(focusableSelector)).filter(
      (el) => !el.hasAttribute("disabled")
    );
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  openButtons.forEach((button) => {
    button.addEventListener("click", openModal);
  });

  if (closeButton) {
    closeButton.addEventListener("click", closeModal);
  }

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) {
      closeModal();
    }
  });

  document.addEventListener("keydown", handleKeydown);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validate()) return;

    submitButton.disabled = true;

    const payload = {
      full_name: inputs.fullName?.value.trim(),
      work_email: inputs.workEmail?.value.trim(),
      company: inputs.company?.value.trim(),
      message: inputs.message?.value.trim()
    };

    try {
      const csrfToken = getCookie("st_csrf");
      const response = await fetch("/api/request-demo", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken
        },
        credentials: "same-origin",
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        form.reset();
        closeModal();
        if (confirmation) confirmation.hidden = false;
      }
    } finally {
      submitButton.disabled = false;
    }
  });
})();
