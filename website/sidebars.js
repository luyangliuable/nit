// @ts-check

// Manual sidebar so page order and grouping are explicit.
/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  docsSidebar: [
    'intro',
    'getting-started',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      items: ['review-mode', 'implement-mode'],
    },
    'configuration',
    'reference',
    'examples',
    'faq',
  ],
};

export default sidebars;
