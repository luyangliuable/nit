// @ts-check
import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'nit',
  tagline: 'A PR centric coding agent powered by pi',
  favicon: 'img/favicon.ico',

  url: 'https://luyangliuable.github.io',
  baseUrl: '/nit/',

  organizationName: 'luyangliuable',
  projectName: 'nit',

  onBrokenLinks: 'warn',

  markdown: {
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          routeBasePath: 'docs',
          editUrl: 'https://github.com/luyangliuable/nit/tree/main/website/',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      colorMode: {
        defaultMode: 'dark',
        respectPrefersColorScheme: true,
      },
      image: 'img/architecture.svg',
      navbar: {
        title: 'nit',
        logo: {
          alt: 'nit logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/luyangliuable/nit',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Introduction', to: '/docs/'},
              {label: 'Getting started', to: '/docs/getting-started'},
              {label: 'Review mode', to: '/docs/review-mode'},
              {label: 'Implement mode', to: '/docs/implement-mode'},
            ],
          },
          {
            title: 'Reference',
            items: [
              {label: 'Configuration', to: '/docs/configuration'},
              {label: 'API reference', to: '/docs/reference'},
              {label: 'Examples', to: '/docs/examples'},
              {label: 'FAQ', to: '/docs/faq'},
            ],
          },
          {
            title: 'More',
            items: [
              {label: 'GitHub', href: 'https://github.com/luyangliuable/nit'},
            ],
          },
        ],
        copyright: `Copyright ${new Date().getFullYear()} nit. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.oneLight,
        darkTheme: prismThemes.oneDark,
        additionalLanguages: ['bash', 'json', 'typescript', 'jsx', 'tsx', 'diff'],
      },
    }),
};

export default config;

// Docs deployed to GitHub Pages via .github/workflows/deploy-docs.yaml
