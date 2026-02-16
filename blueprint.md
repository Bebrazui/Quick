# Nostr Client Blueprint

## Overview

This document outlines the design, features, and development plan for a modern Nostr client built with Next.js and Tailwind CSS. The application will provide a beautiful and intuitive interface for users to interact with the Nostr protocol.

## Project Outline

### Version 0.3 (Audio Messaging)

*   **Feature:** Implemented audio messaging functionality.
*   **`AudioRecorder.tsx`:** Created a new component to handle audio recording. It includes controls for starting, stopping, and canceling the recording, along with a real-time waveform visualizer.
*   **`AudioPlayer.tsx`:** Created a new component to play received audio messages directly in the chat view. It features play/pause controls, a seekable progress bar, and time display.
*   **`nostr.ts` Integration:**
    *   Added `'audio'` to the `MessageType` and `Attachment` types.
    *   Updated message handling logic to process and recognize incoming audio messages.
*   **`fileUtils.ts` Update:**
    *   Added an `isAudioType` helper function to identify audio MIME types.
    *   Modified `processFile` to correctly handle audio file processing and assign the `audio` attachment type.
*   **`ChatView.tsx` Integration:**
    *   Added a microphone icon to the message input area to toggle the `AudioRecorder`.
    *   Implemented state management for the recording process (`isRecordingAudio`).
    *   Modified the `handleSend` and added `handleAudioSend` logic to process and send the recorded audio as an attachment.
    *   Updated the message rendering logic to display the `AudioPlayer` component for messages of type `audio`.

### Version 0.2 (Basic UI)

*   **Home Page:** Created a visually appealing home page with a prominent welcome message.
*   **Layout:** Implemented a global layout with a dark theme background (`bg-gray-900`) and consistent font (Inter).

### Version 0.1 (Initial Setup)

*   **Framework:** Next.js 14 with App Router.
*   **Styling:** Tailwind CSS.
*   **Language:** TypeScript.
*   **Project Structure:**
    *   `/src/app`: Core application routing and pages.
    *   `/src/components`: Reusable React components.
    *   `/src/lib`: Utility functions and libraries.
*   **Configuration:**
    *   Upgraded all `npm` dependencies to be compatible with Next.js 14.
    *   Configured `tailwind.config.ts` and `postcss.config.cjs`.
    *   Established a basic `layout.tsx` and `page.tsx` in the `app` directory.
    *   Created `globals.css` with Tailwind CSS directives.

## Current Plan

The audio messaging feature has been implemented. The next steps will involve further refinement and testing.
