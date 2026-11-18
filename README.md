# Ningún niño sin regalo · The Interactive Poster (3D)

**Actividad 0612 · Desarrollo web en entorno cliente**
Cartel digital interactivo para la **Fundación ITACA (L'Hospitalet)** · **21 de diciembre**

![Captura del cartel](captura.png)

## Concepto

Es una campaña de sensibilización para recaudar donaciones con las que comprar regalos de Navidad a niños y niñas en riesgo de exclusión.

El cartel es una **escena invernal en 3D real** al atardecer:
- una caseta de madera nevada con un banco lleno de regalos;
- un árbol de Navidad iluminado;
- un bosque de pinos;
- animales que viven en la escena: ciervo, zorro, conejo, ardilla y pájaros.

El mensaje es **"Dentro de cada regalo hay una sonrisa"**. Quien explora el cartel con el ratón descubre que un gesto pequeño despierta toda la escena, igual que una donación.

- **Formato:** 848 × 1200 px (A3 vertical). Si la ventana es más pequeña, el cartel se escala de forma proporcional sin deformarse.
- **Tecnología:** HTML, CSS y JavaScript con [Three.js](https://threejs.org/) r128 (WebGL), incluido en `lib/`.
- **Tipografías:** *Fraunces* e *Inter*.
- **Branding:** Fundación ITACA, sello "Juguete Solidario" y hashtag de la campaña.

## Todo en 3D

- **Modelado 3D:**
  - todos los objetos son geometría 3D: cajas, cilindros, conos, esferas, tornos (`LatheGeometry`) para macetas, cubo, regadera y sacos, extrusiones para las estrellas y el frontón, y tubos para la guirnalda, el muelle y la cola de la ardilla;
  - los animales están construidos con piezas articuladas (patas, cuello, cabeza, orejas, alas y cola) que se animan por separado.
- **Texturas procedurales:** se generan con `<canvas>` y ruido fractal repetible, sin imágenes externas:
  - madera envejecida en tablones, con veta, juntas y nudos;
  - tejas, nieve con brillos y relieve, y agujas de pino;
  - corteza, pelaje para cada animal, arpillera, barro, metal galvanizado y cinco papeles de regalo;
  - la luna con cráteres, el cielo de atardecer y las etiquetas "ILUSIÓN" y "semillas de ilusión".

  Muchas usan además `bumpMap` para dar relieve.
- **Iluminación real:**
  - una luz cálida de atardecer con sombras suaves (`PCFSoftShadowMap`);
  - el contraluz frío de la luna y una luz ambiental de cielo y suelo;
  - la luz de la ventana, la de la estrella y **la del cursor**, que es una linterna que proyecta sombras en tiempo real.
- **Atmósfera:** niebla de profundidad, terreno nevado con relieve, estrellas, humo de la chimenea y nieve 3D en dos capas (la cercana se aparta del cursor). Las luces tienen halos y se usa *tone mapping* cinematográfico.
- **Cámara:** al mover el ratón la cámara se desplaza en 3D (parallax real). Al cargar, entra con un travelling.
- **Rendimiento:** solo proyectan sombra las piezas que se notan. Si el ordenador va lento, la calidad baja automáticamente.

## Archivos

| Archivo | Contenido |
|---|---|
| `index.html` | Lienzo WebGL y capa de texto (titular, mensaje, sello, pie) |
| `style.css` | Maquetación de la capa de texto, animaciones de entrada |
| `main.js` | Escena 3D, texturas, animaciones, viento, animales e interacciones |
| `lib/three.min.js` | Three.js r128 |
| `captura.png` | Captura del estado final (`index.html?captura`) |
| `version-svg/` | Versión anterior en SVG (copia de seguridad; se puede borrar) |

## Interacciones

### `mousemove`

`handlePosterMove()` guarda la posición del ratón. En cada fotograma, con esa posición:

- **Hover 3D por *raycasting*** (`updateHover()`): se lanza un rayo desde la cámara para saber qué objeto 3D hay bajo el cursor. Al entrar en un objeto se llama a su función `enter()` y al salir a su función `leave()`, que equivalen a `mouseenter` y `mouseleave` en 3D. Además aparece una etiqueta con su nombre.
- **Cámara 3D** que sigue al ratón (`updateCamera()`).
- **Linterna del cursor:** ilumina y mueve las sombras (`updateLightsFx()`).
- **Viento:** al mover el ratón deprisa, sopla (`updateWind()`).
- **Miradas:** las cabezas de todos los animales giran hacia el cursor (`updateHeads()`).
- **Hierba seca:** se aparta del cursor.
- **Nieve cercana:** se aparta del cursor (`updateSnow()`).
- **Titular:** las letras se apartan del cursor (`updateLetters()`).
- **Botón de donar:** es magnético (`updateCta()`).

### Reacciones de cada objeto 3D (`REACTIONS`)

| Objeto | Al pasar el ratón |
|---|---|
| Luna | El halo crece y las estrellas brillan más |
| Pinos | Se sacuden y cae su nieve |
| Ciervo | Deja de pasear, levanta la cabeza, mueve orejas y rabo, corazones |
| Zorro | Se detiene, te mira y dice "¡yip!" |
| Chimenea | Tiembla y suelta una gran bocanada de humo |
| Nieve del tejado | Una placa resbala, cae y vuelve a cuajar |
| Alero | Las luces se persiguen y los carámbanos gotean |
| Casita de pájaros | Se balancea y se asoma un pajarito |
| Arrendajo | Sube el tejado a saltitos y grazna |
| Ventana | Se enciende la lámpara y el osito saluda |
| Corona | Se balancea y suenan las campanillas |
| Rastrillo y pala | Se tambalea y vibra / se levanta y se clava en la nieve |
| Maceta boca abajo | Se levanta y aparece un ratoncito |
| Caja de música | Se abre, gira una estrella y suenan notas |
| Semillas de ilusión | El saquito se inclina, caen semillas y brota una planta |
| Macetas | Tintinean |
| Regadera | Se inclina y riega el acebo |
| Acebo y carbonero | Las hojas se agitan / el pájaro salta y picotea |
| Regalo grande | Se abre la tapa y sale una estrella con muelle |
| Regalo pequeño | La tapa sale volando y estalla el confeti |
| Ardilla | Cambia la bellota por un regalo |
| Árbol / estrella | Las luces se persiguen y las bolas se mecen / la estrella gira y lanza destellos |
| Cardenal | Vuela en círculo alrededor del árbol |
| Conejo, gorrión, petirrojo | Salta / echa a volar y vuelve / avanza a saltitos y canta |
| Saco de ilusión | Se sacude y asoman los regalos (clic: ¡salen disparados!) |
| Regalos caídos | Se abren, muestran lo que llevan dentro y dan un salto |

### `mouseenter` / `mouseleave` del DOM

Los elementos HTML usan `addEventListener('mouseenter' | 'mouseleave')`:

- **Las cuatro palabras clave:** cada una tiene un efecto propio (`WORD_FX`).
- **La fecha "21":** gira en 3D.
- **El logo:** el barco se mece.
- **El sello:** se estampa.
- **El sello "10 €":** gira más rápido.
- **El botón de donar:** cambia de texto y de color.

### `click`

- **Clic en cualquier superficie 3D** (suelo, tejado, banco…): cae un regalo con física sencilla (gravedad, rebote y giro) que se posa justo en ese punto.
- **Clic en el saco:** salen disparados cinco regalos.

## Viento y vida propia

- **Viento:** combina ráfagas naturales y el movimiento del ratón. Mece el árbol, los pinos, las bolas, las bombillas, la casita, la corona, el acebo y la hierba. Arrastra el humo y la nieve, y en las ráfagas fuertes arranca hojas y nieve del tejado.
- **Animales:**
  - el ciervo pasea moviendo las patas, pasta y mira alrededor;
  - un zorro cruza el bosque trotando y desaparece detrás de la caseta;
  - el conejo y los pájaros dan saltitos y picotean;
  - la ardilla mordisquea su bellota;
  - todos parpadean y respiran;
  - una bandada cruza el cielo de vez en cuando.

## Cómo ejecutarlo

Abre `index.html` en un navegador moderno con WebGL. Three.js va incluido en `lib/`, así que no hace falta instalar nada.

- **Captura del estado final:** abre `index.html?captura`.
- **Sin conexión:** las fuentes se cargan desde Google Fonts. Si no hay conexión, se usan fuentes del sistema.

> La escena está modelada desde cero para este cartel. El logotipo de la Fundación ITACA y el sello "Juguete Solidario" son marcas provisionales y se pueden sustituir por los oficiales.
