import Image from 'next/image'

/**
 * Real coffee photography used as decorative UI art on the landing page and the
 * farmer home page. The image is stored locally in `public/images/` and rendered
 * with `next/image` in `unoptimized` mode, matching the app's existing
 * convention for static assets.
 *
 * Image credit (public source, CC BY-SA 4.0, via Wikimedia Commons):
 * "Coffea arabica 42zz.jpg" by David J. Stang. Pages badge the credit in their footer.
 */

const COFFEE_PHOTO_SOURCE = {
  src: '/images/coffee-plant.jpg',
  alt: 'Follaje de café (Coffea spp.)',
  label: 'Café · Coffea spp.',
  position: 'center',
} as const

/**
 * Full-width photographic banner blended under a brand-green gradient with a
 * short Spanish caption on top. Decorative — it carries no interactive content,
 * and the caption instead of the image conveys the text.
 */
export function CropPhotoBanner({
  caption,
  className = '',
  heightClassName = 'h-52 sm:h-64 lg:h-72',
  priority = false,
}: {
  caption?: string
  className?: string
  heightClassName?: string
  priority?: boolean
}) {
  return (
    <section
      aria-label="Fotografía del cultivo de café"
      className={`relative overflow-hidden rounded-[2rem] border border-white shadow-xl shadow-[#344c3215] ${heightClassName} ${className}`}
    >
      <div aria-hidden="true" className="absolute inset-0">
        <Image
          src={COFFEE_PHOTO_SOURCE.src}
          alt=""
          fill
          unoptimized
          priority={priority}
          sizes="100vw"
          className="object-cover"
          style={{ objectPosition: COFFEE_PHOTO_SOURCE.position }}
        />
      </div>
      {/* Brand-green blend so the photo reads as one AgriTech banner */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-gradient-to-r from-[#1e3025]/70 via-[#244b34]/25 to-[#1e3025]/60"
      />
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#141f18]/70 to-transparent" />
      <span className="absolute left-4 top-4 rounded-full border border-white/30 bg-[#1e3025]/45 px-3 py-1 text-[11px] font-semibold tracking-wide text-white/90 backdrop-blur-sm sm:left-6 sm:top-5 sm:px-4 sm:text-xs">
        {COFFEE_PHOTO_SOURCE.label}
      </span>
      {caption && (
        <p className="absolute inset-x-4 bottom-4 max-w-2xl text-sm font-medium leading-6 text-white sm:bottom-5 sm:inset-x-6 sm:text-base">
          {caption}
        </p>
      )}
    </section>
  )
}

/**
 * Short photographic band (object-cover strip) used as the top edge of a card,
 * fading into the white card body below it. Decorative.
 */
export function CropPhotoBand({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative ${className}`}>
      <Image
        src={COFFEE_PHOTO_SOURCE.src}
        alt=""
        fill
        unoptimized
        sizes="(max-width: 768px) 100vw, 50vw"
        className="object-cover"
        style={{ objectPosition: COFFEE_PHOTO_SOURCE.position }}
      />
      {/* Green tint for identity + fade into the white card body */}
      <div aria-hidden="true" className="absolute inset-0 bg-[#244b34]/15" />
      <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white" />
    </div>
  )
}

/**
 * Very low-opacity, gradient-masked photo layer used as a soft "partial
 * background" behind a section's content. Purely decorative; sits behind the
 * content of a `relative` parent (content should live in a `relative` child).
 */
export function CropPhotoWash({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}>
      <Image
        src={COFFEE_PHOTO_SOURCE.src}
        alt=""
        fill
        unoptimized
        sizes="100vw"
        className="object-cover opacity-[0.13]"
        style={{ objectPosition: COFFEE_PHOTO_SOURCE.position }}
      />
      {/* Fades the photo in and out so it melts into the page background */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, #f5f7f1 0%, rgba(245,247,241,0.55) 45%, #f5f7f1 100%)',
        }}
      />
    </div>
  )
}
