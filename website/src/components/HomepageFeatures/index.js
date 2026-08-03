import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'Review pull requests',
    img: '/img/review-flow.svg',
    to: '/docs/review-mode',
    description:
      'A poller reviews each incoming PR read only, generates an HTML change visualization, and queues the verdict for your approval.',
  },
  {
    title: 'Implement fixes',
    img: '/img/implement-flow.svg',
    to: '/docs/implement-mode',
    description:
      'Switch to a full pi coding session on a local clone, with a git panel for branches, diffs, commit, push, and open PR.',
  },
  {
    title: 'Human in the loop',
    img: '/img/faq.svg',
    to: '/docs/faq',
    description:
      'Nothing is posted to GitHub until you press a button. nit reuses your pi and gh credentials and stores none of its own.',
  },
];

function Feature({title, img, description, to}) {
  return (
    <div className={clsx('col col--4')}>
      <Link to={to} className={styles.card}>
        <img className={styles.cardImage} src={useBaseUrl(img)} alt={title} />
        <div className={styles.cardBody}>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </Link>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
