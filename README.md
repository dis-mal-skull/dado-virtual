# Dado Virtual

Aplicación de dado virtual 3D para Android con físicas reales.

## Características

- 🎲 Dado 3D con motor de físicas real (Three.js + cannon.js)
- ➕ Tirada de 1 o 2 dados
- 🎨 Cambio de color del dado (8 colores + color libre)
- 🎲 Dados RPG: D4, D6, D8, D10, D12, D20
- 🔢 Contador total de tiradas
- 📜 Histórico de los últimos 50 resultados (persistente)
- 📊 Estadísticas de frecuencia de cada cara
- 🔊 Sonido y vibración al tirar
- 📱 Agitar el teléfono para tirar
- 🤝 Detección de dobles y suma al tirar 2 dados
- 🌗 Tema oscuro / claro

## Compilar

```bash
./gradlew assembleRelease
```

El APK se genera en `app/build/outputs/apk/release/`.

## Estructura

```
app/src/main/
├── java/com/example/dadovirtual/MainActivity.java   # WebView + sensores + vibración
└── assets/
    ├── index.html        # Interfaz
    ├── css/style.css     # Estilos (temas oscuro/claro)
    └── js/
        ├── three.min.js  # Motor 3D
        ├── cannon.min.js # Físicas
        └── app.js        # Lógica del dado
```

## Notas

- La app usa un WebView local, no necesita permisos de red.
- El dado usa físicas de cuerpo rígido con esquinas redondeadas para una tirada realista.
- Los datos (historial, tiradas, configuración) se guardan localmente en el dispositivo.

## Licencia

MIT License — ver [LICENSE](LICENSE).