# Aula Virtual Quiz Solver

Extensión de Chrome (Manifest V3) que resuelve cuestionarios de Moodle con la API de Groq.

## Instalación

1. Descarga el repositorio (Code > Download ZIP) y descomprímelo.
2. `chrome://extensions` > activa el modo desarrollador > **Cargar descomprimida** > elige esta carpeta.
3. Abre los ajustes de la extensión y pon tu API key de Groq.

## Modo discreto (v1.1.0)

Los controles son los iconos del pie de EducaMadrid (abajo a la derecha):

- **Certificado de conformidad** (`#emENS`) = Resolver
- **Drogas** (`#buzonPRCD`) = Parar
- Alternativa en ajustes: solo el icono de Drogas (1.er clic = Resolver, 2.º = Parar).

Si hay un error de la extensión se ocultan el botón «?» de ayuda y el enlace «Ayuda» del pie; cuando el error desaparece (respuesta correcta, Resolver o Parar) vuelven a aparecer.

El panel flotante está oculto por defecto; se puede mostrar desde los ajustes.
