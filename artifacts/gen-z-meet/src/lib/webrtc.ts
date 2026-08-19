import { useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  addDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
];

export type RemoteParticipant = {
  id: string;
  name: string;
  isMuted?: boolean;
  cameraOn?: boolean;
  stream?: MediaStream | null;
  connectionState?: RTCPeerConnectionState;
};

export function useWebRTC({
  meetingId,
  userId,
  userName,
  localStream,
  isLive,
  isMuted,
  cameraOn,
}: {
  meetingId: string;
  userId: string;
  userName: string;
  localStream: MediaStream | null;
  isLive: boolean;
  isMuted: boolean;
  cameraOn: boolean;
}) {
  const [remoteParticipants, setRemoteParticipants] = useState<RemoteParticipant[]>([]);
  const [connectionStates, setConnectionStates] = useState<Record<string, RTCPeerConnectionState>>({});

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const candidateQueuesRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(localStream);
  localStreamRef.current = localStream;

  // Sync presence and status (mute / camera / display name) to Firestore
  useEffect(() => {
    if (!meetingId || !userId || !isLive) return;
    const participantDoc = doc(db, 'rooms', meetingId, 'participants', userId);
    void setDoc(
      participantDoc,
      {
        id: userId,
        name: userName || 'Participant',
        isMuted,
        cameraOn,
        lastSeen: serverTimestamp(),
      },
      { merge: true }
    );
  }, [meetingId, userId, userName, isMuted, cameraOn, isLive]);

  // Main WebRTC Mesh Signaling
  useEffect(() => {
    if (!meetingId || !userId || !isLive) return;

    console.log(`[WebRTC Mesh] Initializing room ${meetingId} for user ${userId} (${userName})`);
    const unsubscribes: Unsubscribe[] = [];
    let isCleanedUp = false;

    // Helper: Create a peer connection for a specific target peer
    const getOrCreatePeerConnection = (targetPeerId: string, targetPeerName: string): RTCPeerConnection => {
      const existing = peersRef.current.get(targetPeerId);
      if (existing && existing.signalingState !== 'closed') {
        return existing;
      }

      console.log(`[WebRTC Mesh] Creating PeerConnection with target: ${targetPeerId} (${targetPeerName})`);
      const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peersRef.current.set(targetPeerId, pc);

      if (!candidateQueuesRef.current.has(targetPeerId)) {
        candidateQueuesRef.current.set(targetPeerId, []);
      }

      // Pre-create transceivers so audio and video m-lines are negotiated in SDP from the start
      const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
      const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });

      // Attach current local tracks if available
      if (localStreamRef.current) {
        const audioTrack = localStreamRef.current.getAudioTracks()[0];
        if (audioTrack) {
          console.log(`[WebRTC Mesh] Attaching audio track to transceiver for ${targetPeerId}`);
          void audioTransceiver.sender.replaceTrack(audioTrack);
        }
        const videoTrack = localStreamRef.current.getVideoTracks()[0];
        if (videoTrack) {
          console.log(`[WebRTC Mesh] Attaching video track to transceiver for ${targetPeerId}`);
          void videoTransceiver.sender.replaceTrack(videoTrack);
        }
      }

      // Send local ICE candidates to target peer
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log(`[WebRTC Mesh] Sending ICE candidate to ${targetPeerId}`);
          const candidatesCol = collection(db, 'rooms', meetingId, 'candidates', targetPeerId, 'items');
          void addDoc(candidatesCol, {
            candidate: event.candidate.toJSON(),
            from: userId,
            fromName: userName,
            createdAt: serverTimestamp(),
          });
        }
      };

      // Handle remote media track arrival smoothly
      pc.ontrack = (event) => {
        console.log(`[WebRTC Mesh] Received remote track (${event.track.kind}, id=${event.track.id}) from ${targetPeerId}`);
        setRemoteParticipants((prev) => {
          const index = prev.findIndex((p) => p.id === targetPeerId);
          if (index >= 0) {
            const existing = prev[index];
            const existingStream = existing.stream ?? new MediaStream();
            const oldTrack = existingStream.getTracks().find((t) => t.kind === event.track.kind);
            if (oldTrack && oldTrack.id !== event.track.id) {
              existingStream.removeTrack(oldTrack);
            }
            if (!existingStream.getTracks().some((t) => t.id === event.track.id)) {
              existingStream.addTrack(event.track);
            }
            const updated = [...prev];
            updated[index] = { ...existing, stream: existingStream };
            return updated;
          }
          const newStream = event.streams[0] ?? new MediaStream();
          if (!event.streams[0] && !newStream.getTracks().some((t) => t.id === event.track.id)) {
            newStream.addTrack(event.track);
          }
          return [...prev, { id: targetPeerId, name: targetPeerName, stream: newStream }];
        });
      };

      // State tracking & logging
      pc.onconnectionstatechange = () => {
        console.log(`[WebRTC Mesh] Connection state with ${targetPeerId}: ${pc.connectionState}`);
        setConnectionStates((prev) => ({ ...prev, [targetPeerId]: pc.connectionState }));
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
          console.log(`[WebRTC Mesh] Peer ${targetPeerId} disconnected or failed`);
        }
      };

      pc.onsignalingstatechange = () => {
        console.log(`[WebRTC Mesh] Signaling state with ${targetPeerId}: ${pc.signalingState}`);
      };

      return pc;
    };

    // Helper: Drain queued ICE candidates for a peer
    const drainCandidates = async (peerId: string, pc: RTCPeerConnection) => {
      const queue = candidateQueuesRef.current.get(peerId) ?? [];
      if (queue.length > 0) {
        console.log(`[WebRTC Mesh] Draining ${queue.length} ICE candidates for ${peerId}`);
        while (queue.length > 0) {
          const cand = queue.shift();
          if (cand) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (err) {
              console.error(`[WebRTC Mesh] Error adding queued ICE candidate for ${peerId}:`, err);
            }
          }
        }
      }
    };

    // 1. Join room presence in Firestore
    const selfDoc = doc(db, 'rooms', meetingId, 'participants', userId);
    void setDoc(selfDoc, {
      id: userId,
      name: userName || 'Participant',
      isMuted,
      cameraOn,
      joinedAt: serverTimestamp(),
    });

    // 2. Listen for all participants in the room
    const participantsCol = collection(db, 'rooms', meetingId, 'participants');
    const unsubParticipants = onSnapshot(participantsCol, (snapshot) => {
      if (isCleanedUp) return;

      const currentRemoteList: RemoteParticipant[] = [];
      const activePeerIds = new Set<string>();

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as { id: string; name: string; isMuted?: boolean; cameraOn?: boolean };
        if (data.id && data.id !== userId) {
          activePeerIds.add(data.id);
          currentRemoteList.push({
            id: data.id,
            name: data.name || 'Participant',
            isMuted: data.isMuted,
            cameraOn: data.cameraOn,
          });
        }
      });

      // Update participant UI list (preserving existing stream instances)
      setRemoteParticipants((prev) => {
        return currentRemoteList.map((remote) => {
          const existing = prev.find((p) => p.id === remote.id);
          return existing ? { ...remote, stream: existing.stream } : remote;
        });
      });

      // Close connections for peers that have left the room
      peersRef.current.forEach((pc, peerId) => {
        if (!activePeerIds.has(peerId)) {
          console.log(`[WebRTC Mesh] Peer ${peerId} left the room. Closing connection.`);
          pc.close();
          peersRef.current.delete(peerId);
          candidateQueuesRef.current.delete(peerId);
        }
      });

      // Full-Mesh connection initiation:
      // Deterministic rule: The peer with the lexicographically larger userId creates the offer
      currentRemoteList.forEach((remote) => {
        if (userId > remote.id) {
          const existingPc = peersRef.current.get(remote.id);
          if (!existingPc || existingPc.signalingState === 'closed') {
            console.log(`[WebRTC Mesh] Deterministic offerer (${userId} > ${remote.id}). Initiating offer to ${remote.id}...`);
            const pc = getOrCreatePeerConnection(remote.id, remote.name);
            void (async () => {
              try {
                const offer = await pc.createOffer({
                  offerToReceiveAudio: true,
                  offerToReceiveVideo: true,
                });
                await pc.setLocalDescription(offer);
                console.log(`[WebRTC Mesh] Offer created for ${remote.id}`);

                const offerDoc = doc(db, 'rooms', meetingId, 'offers', `${remote.id}_from_${userId}`);
                await setDoc(offerDoc, {
                  offer: { type: offer.type, sdp: offer.sdp },
                  to: remote.id,
                  from: userId,
                  fromName: userName,
                  createdAt: serverTimestamp(),
                });
                console.log(`[WebRTC Mesh] Offer written to Firestore for ${remote.id}`);
              } catch (err) {
                console.error(`[WebRTC Mesh] Failed to create/write offer for ${remote.id}:`, err);
              }
            })();
          }
        }
      });
    });
    unsubscribes.push(unsubParticipants);

    // 3. Listen for incoming offers directed to this user
    const offersCol = collection(db, 'rooms', meetingId, 'offers');
    const unsubOffers = onSnapshot(offersCol, (snapshot) => {
      if (isCleanedUp) return;

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data() as {
            offer: { type: RTCSdpType; sdp: string };
            to: string;
            from: string;
            fromName: string;
          };

          if (data.to === userId && data.from && data.offer) {
            console.log(`[WebRTC Mesh] Received offer from ${data.from} (${data.fromName})`);
            const pc = getOrCreatePeerConnection(data.from, data.fromName);

            void (async () => {
              try {
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
                console.log(`[WebRTC Mesh] Remote description (offer) set for ${data.from}`);
                await drainCandidates(data.from, pc);

                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                console.log(`[WebRTC Mesh] Answer created for ${data.from}`);

                const answerDoc = doc(db, 'rooms', meetingId, 'answers', `${data.from}_from_${userId}`);
                await setDoc(answerDoc, {
                  answer: { type: answer.type, sdp: answer.sdp },
                  to: data.from,
                  from: userId,
                  fromName: userName,
                  createdAt: serverTimestamp(),
                });
                console.log(`[WebRTC Mesh] Answer written to Firestore for ${data.from}`);
              } catch (err) {
                console.error(`[WebRTC Mesh] Error answering offer from ${data.from}:`, err);
              }
            })();
          }
        }
      });
    });
    unsubscribes.push(unsubOffers);

    // 4. Listen for incoming answers directed to this user
    const answersCol = collection(db, 'rooms', meetingId, 'answers');
    const unsubAnswers = onSnapshot(answersCol, (snapshot) => {
      if (isCleanedUp) return;

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added' || change.type === 'modified') {
          const data = change.doc.data() as {
            answer: { type: RTCSdpType; sdp: string };
            to: string;
            from: string;
            fromName: string;
          };

          if (data.to === userId && data.from && data.answer) {
            console.log(`[WebRTC Mesh] Received answer from ${data.from} (${data.fromName})`);
            const pc = peersRef.current.get(data.from);
            if (pc && pc.signalingState === 'have-local-offer') {
              void (async () => {
                try {
                  await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
                  console.log(`[WebRTC Mesh] Remote description (answer) set for ${data.from}`);
                  await drainCandidates(data.from, pc);
                } catch (err) {
                  console.error(`[WebRTC Mesh] Error setting remote description (answer) for ${data.from}:`, err);
                }
              })();
            }
          }
        }
      });
    });
    unsubscribes.push(unsubAnswers);

    // 5. Listen for incoming ICE candidates directed to this user
    const candidatesCol = collection(db, 'rooms', meetingId, 'candidates', userId, 'items');
    const unsubCandidates = onSnapshot(candidatesCol, (snapshot) => {
      if (isCleanedUp) return;

      snapshot.docChanges().forEach((change) => {
        if (change.type === 'added') {
          const data = change.doc.data() as { candidate: RTCIceCandidateInit; from: string };
          if (!data?.from || data.from === userId || !data.candidate) return;

          console.log(`[WebRTC Mesh] Received ICE candidate from ${data.from}`);
          const pc = peersRef.current.get(data.from);
          if (pc && pc.remoteDescription) {
            void pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch((err) => {
              console.error(`[WebRTC Mesh] Error adding ICE candidate from ${data.from}:`, err);
            });
          } else {
            console.log(`[WebRTC Mesh] Remote description not ready for ${data.from}, queuing ICE candidate`);
            const queue = candidateQueuesRef.current.get(data.from) ?? [];
            queue.push(data.candidate);
            candidateQueuesRef.current.set(data.from, queue);
          }
        }
      });
    });
    unsubscribes.push(unsubCandidates);

    // Cleanup on unmount / room leave
    return () => {
      isCleanedUp = true;
      console.log(`[WebRTC Mesh] Cleaning up room ${meetingId} for ${userId}`);
      unsubscribes.forEach((unsub) => unsub());

      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
      candidateQueuesRef.current.clear();
      setRemoteParticipants([]);

      // Remove presence doc from Firestore
      void deleteDoc(doc(db, 'rooms', meetingId, 'participants', userId)).catch(() => {});
    };
  }, [meetingId, userId, userName, isLive]);

  // Sync local stream tracks (mic, camera, screen share) to all active peer connections
  useEffect(() => {
    if (peersRef.current.size === 0) return;
    console.log(`[WebRTC Mesh] Syncing local stream tracks to ${peersRef.current.size} peer connections`);

    const audioTrack = localStream?.getAudioTracks()[0] ?? null;
    const videoTrack = localStream?.getVideoTracks()[0] ?? null;

    peersRef.current.forEach((pc, peerId) => {
      const transceivers = pc.getTransceivers();
      const audioTransceiver = transceivers.find((t) => t.receiver.track.kind === 'audio');
      if (audioTransceiver) {
        void audioTransceiver.sender.replaceTrack(audioTrack).catch((err) => {
          console.error(`[WebRTC Mesh] Error replacing audio track for ${peerId}:`, err);
        });
      }

      const videoTransceiver = transceivers.find((t) => t.receiver.track.kind === 'video');
      if (videoTransceiver) {
        void videoTransceiver.sender.replaceTrack(videoTrack).catch((err) => {
          console.error(`[WebRTC Mesh] Error replacing video track for ${peerId}:`, err);
        });
      }
    });
  }, [localStream]);

  return {
    remoteParticipants,
    connectionStates,
  };
}
