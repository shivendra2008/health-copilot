/** Tiny store counting in-flight API requests, so the UI can show a global loading bar. */
let pending = 0;
const listeners = new Set<() => void>();

export const network = {
  begin() {
    pending += 1;
    listeners.forEach((l) => l());
  },
  end() {
    pending = Math.max(0, pending - 1);
    listeners.forEach((l) => l());
  },
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  getSnapshot: () => pending,
  getServerSnapshot: () => 0,
};
