import './globals.css';

export const metadata = {
  title: 'TestRail Uploader',
  description: 'Upload test report and post results for one framework at a time.',
};

const themeBootScript = `
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    } else if (!t) {
      var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
      if (prefersLight) document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
