Sample solution (esta vez de verdad)

Meter URLs de youtube en una lista -> Utiliza yt-dlp para descargar las canciones -> Seleccionas la parte que quieras descargar -> Profit

EXTRAS
Prioridad 1 - Idealmente poder buscar videos desde la propia app y añadirlos.
Si se puede hacer drag and drop con los samples mejor
Prioridad 2 - Si puedes importar tus propias playlists mejor
Prioridad 3 - Si se pueden organizar por tags mejor
Prioridad 4 - Si se pueden organizar con IA mejor

Create a react application to host on docker and expose a port for the frontend. It's going to live on a proxmox container. It should have a youtube search functionality and import playlists functionality. This is a sampler extractor, you'd use youtube-dlp to download the tracks added and give a simple UI to select which portion of the sample you actually want to download. You can create several slices per track. You can also add them through just importing the links on a text format and whatever the youtube API uses as an output format for importing the links

Make it so I can import my private playlists from my youtube account

If it can use tags for samples the better

If it can use a locally deployed AI model to analyze the descriptions that come from the youtube API to extract tags the better. Use a model that is modest on resources but good, make one prompt/new instance of conversation per track, maybe they can run in parallel.
