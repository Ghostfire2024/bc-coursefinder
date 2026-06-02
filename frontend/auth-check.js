/**
 * BC CourseFinder™ - Auth Guard
 * Include this script at the top of any page that requires a login.
 * Redirects to auth.html if no valid token is found.
 */
(async function () {
  const token = localStorage.getItem("bc_token");
  if (!token) {
    window.location.replace("auth.html");
    return;
  }

  try {
    const res = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("invalid");

    // Populate user info available globally
    const { user } = await res.json();
    window.currentUser = user;
  } catch {
    localStorage.removeItem("bc_token");
    localStorage.removeItem("bc_user");
    window.location.replace("auth.html");
  }
})();
