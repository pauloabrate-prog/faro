# Faro Live Studio

Faro Live Studio switches between local camera inputs and previews the selected program in a master monitor. It can overlay multiple movable and resizable still images and looping videos at once, plus a title. Its lightweight audio mixer supports up to three independent microphone channels with gain and mute controls, the audio from every video layer, and triggered sound clips that can play alongside the microphones. Camera changes can use a cut or a 0.4 second dissolve; simple color looks can be applied to the program output. It does not broadcast the editing timeline.

## FFmpeg requirement

The desktop process looks for `ffmpeg.exe` (Windows) or `ffmpeg` (macOS/Linux) in Faro's `native/bin` folder first and then on `PATH`. The app installer does not bundle FFmpeg. This keeps Faro from silently redistributing an FFmpeg build with unknown configuration or license terms. To enable live output on another computer, install an FFmpeg build that includes `libx264`, AAC, and RTMPS, or place a compatible binary in `native/bin` before packaging. Review the selected build's license and source-offer requirements before distributing it.

## Operation

1. Open Live Studio and allow Faro to access cameras and the microphone.
2. Add up to three USB cameras or HDMI capture cards. The first three selected sources become slots **A**, **B** and **C**. Raise or lower their faders to blend them in the master output; press a slot button to cut or dissolve automatically to that camera.
3. Adjust the three microphone faders or mute a channel. Video overlays and sound effects have their own audio faders too. Choose a cut or dissolve and a color look. Add any number of images and videos from the Media library or files; each new layer stays on screen with the others. Select a layer in the list, then drag it in the master monitor to move it or use its lower-right handle to resize it. While live, click sound buttons to play them over the microphone and video audio mix.
4. Click **Abrir ventana secundaria** to detach the live studio into a resizable, maximizable window. You can minimize the editor and keep the live controls visible; **Volver al editor** docks the same session back into the editor.
5. Enter the server URL and private stream key supplied by the streaming service. Use a test key first. The key is sent through the local desktop IPC to FFmpeg and included in FFmpeg's output URL; other local processes with permission to inspect process arguments may be able to see it.
6. Select a bitrate, then click **Go live**. Optionally click **Grabar vivo** and choose a name and folder in the save dialog. Faro records the composed video and audio locally as WebM; click **Detener grabación** to finish and save the file. Stop the stream from the Live Studio dialog.

The FFmpeg subprocess maps the browser's VP8/VP9 WebM output to H.264/AAC in FLV for RTMP(S). Capture cards appear only if Windows/macOS/Linux exposes them as camera input devices. Camera permissions, available codecs, network bandwidth and destination account settings affect the result.
