/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme")
module.exports = {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue,mjs}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["Roboto", "sans-serif", ...defaultTheme.fontFamily.sans],
      },
      colors: {
        cyber: {
          cyan: '#00C8FF',
          pink: '#FF0066',
          gold: '#FFC800',
          purple: '#8A2BE2',
          green: '#00FF88',
          red: '#E60012',
          magenta: '#FF00FF',
          blue: '#0066FF',
          orange: '#FF6600',
        },
      },
      boxShadow: {
        'cyber-cyan': '0 0 20px rgba(0,200,255,0.3)',
        'cyber-pink': '0 0 20px rgba(255,0,102,0.3)',
        'cyber-gold': '0 0 20px rgba(255,200,0,0.3)',
        'cyber-purple': '0 0 20px rgba(138,43,226,0.3)',
        'cyber-glow': '0 0 40px rgba(0,200,255,0.2), 0 0 80px rgba(0,200,255,0.1)',
      },
      animation: {
        'glow-pulse': 'glow-pulse 3s ease-in-out infinite',
        'gradient-flow': 'gradient-flow 6s ease infinite',
        'float': 'float 3s ease-in-out infinite',
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
}
