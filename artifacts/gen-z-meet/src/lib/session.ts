const SESSION_KEY = "gen-z-meet-demo-session";

export function hasDemoSession() {
  return typeof window !== "undefined" && window.localStorage.getItem(SESSION_KEY) === "active";
}

export function startDemoSession() {
  window.localStorage.setItem(SESSION_KEY, "active");
}

export function clearDemoSession() {
  window.localStorage.removeItem(SESSION_KEY);
}