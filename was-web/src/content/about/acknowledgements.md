# Open-source acknowledgements

_The open-source software Wall & Shadow is built with._

## Wall & Shadow's own licence

Wall & Shadow is open-source software, released under the **Apache License,
Version 2.0**. The source code is available at
[github.com/KaiEkkrin/wallandshadow](https://github.com/KaiEkkrin/wallandshadow),
and the full licence text is in the `LICENSE` file in that repository.

## Third-party software in the app

Wall & Shadow's web application is built with many open-source libraries. When
you use the app, your browser downloads and runs code from those libraries as
part of Wall & Shadow's own code. Their licences — such as the MIT, BSD, ISC, and
Apache licences — require that their copyright and licence notices are included
wherever that code is distributed.

The notices below cover the open-source libraries whose code is included in the
Wall & Shadow web application that runs in your browser. Software used only on
our servers is not distributed to you and is not listed here.

## Third-party notices

<!-- THIRD-PARTY-NOTICES:START — generated content, do not edit by hand -->

_**Placeholder.** The full list of third-party libraries and their licence text
is generated automatically when the application is built, so that it always
matches the code actually shipped to your browser. This placeholder block will
be replaced by — or will link to — that generated content. See the main
implementation plan ("THIRD-PARTY-NOTICES approach") for how the generation step
works._

<!-- THIRD-PARTY-NOTICES:END -->

## Fonts and other assets

Wall & Shadow also bundles fonts that are handled outside the generated notices
above:

- **Princess Sofia** — the display font used for the Wall & Shadow logo,
  licensed under the **SIL Open Font License 1.1** (© 2012 Font Diner, Inc.).
  The application loads it from the `@fontsource/princess-sofia` package, so it
  is also listed in the third-party notices above. The static landing page loads
  a self-hosted copy of the same font; its licence text is in
  `public/fonts/princess-sofia-OFL.txt` in the repository.
- **Helvetiker** — the typeface used for the 3-D text rendered on maps
  (`public/fonts/helvetiker_bold.typeface.json`). It is distributed under the
  MgOpen font licence (© 2004 MAGENTA Ltd.), reproduced in `public/fonts/LICENSE`.

All icons, logos, and other images in Wall & Shadow are original work created
for the project and need no third-party attribution.
