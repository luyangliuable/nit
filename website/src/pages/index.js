import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import HomepageFeatures from '@site/src/components/HomepageFeatures';

import styles from './index.module.css';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero', styles.heroBanner)}>
      <div className="container">
        <img
          className={styles.heroLogo}
          src={useBaseUrl('/img/wordmark.svg')}
          alt="nit"
          width="240"
        />
        <p className={styles.heroTagline}>{siteConfig.tagline}</p>
        <p className={styles.heroSub}>
          Watch a repository, review every incoming pull request, and approve with
          a button. Then fix it with the pi coding agent, all in one place.
        </p>
        <div className={styles.buttons}>
          <Link className="button button--primary button--lg" to="/docs/">
            Get started
          </Link>
          <Link
            className="button button--secondary button--lg"
            to="/docs/review-mode">
            How review works
          </Link>
        </div>
        <img
          className={styles.heroDiagram}
          src={useBaseUrl('/img/architecture.svg')}
          alt="nit architecture"
        />
      </div>
    </header>
  );
}

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={siteConfig.title}
      description="A PR centric coding agent powered by pi">
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
