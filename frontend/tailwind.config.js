/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#303548",
        surface: "#3A4058",
        "surface-hover": "#454B62",
        copper: "#D4956A",
        "copper-light": "#E0AC85",
        "warm-white": "#F2EDE8",
        "warm-gray": "#8A8690",
        "warm-muted": "#5A5660",
      },
      fontFamily: {
        display: ['"DM Serif Display"', "serif"],
        sans: [
          '"Karla"',
          "-apple-system",
          "BlinkMacSystemFont",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      boxShadow: {
        gallery:
          "0 2px 8px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.04)",
        "gallery-hover":
          "0 8px 24px rgba(0,0,0,0.4), 0 0 20px rgba(212,149,106,0.08)",
        "gallery-xl":
          "0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04)",
        nav: "0 1px 0 rgba(255,255,255,0.04)",
      },
      keyframes: {
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in-up": "fade-in-up 0.5s ease-out both",
      },
    },
  },
  plugins: [],
};
