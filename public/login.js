const form = document.querySelector("#login-form");
const feedback = document.querySelector("#login-feedback");
if (new URLSearchParams(location.search).has("expired")) feedback.textContent = "Your session ended. Sign in again to continue.";
document.querySelector("#show-password").addEventListener("change", event => {
  form.elements.password.type = event.target.checked ? "text" : "password";
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  feedback.textContent = "Signing in…";
  try {
    const response = await fetch("/api/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: form.elements.username.value, password: form.elements.password.value }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");
    form.elements.password.value = "";
    location.replace("/");
  } catch (error) { feedback.textContent = error.message; }
  finally { button.disabled = false; }
});
