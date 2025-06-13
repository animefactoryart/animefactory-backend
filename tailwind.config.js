/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./public/**/*.html",           // Your HTML files
    "./src/**/*.{js,ts,jsx,tsx}",   // If you're using React/Vite/etc.
    "./*.{html,js}",                // Add this line for plain HTML/JS
    "./node_modules/flowbite/**/*.js", // Required for Flowbite
  ],
  theme: {
    extend: {},
  },
  plugins: [
    require('flowbite/plugin')
  ],
}
