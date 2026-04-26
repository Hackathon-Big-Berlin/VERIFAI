import { useLiveKitRoom } from "@/hooks/useLiveKitRoom";
import { Switch } from "@/components/ui/switch"; 
import { Label } from "@/components/ui/label";

export function InterviewModeToggle({ liveKit }: { liveKit: ReturnType<typeof useLiveKitRoom> }) {
  // Graceful fallback to prevent crashes if liveKit isn't ready
  if (!liveKit) return null;

  return (
    <div className="flex items-center gap-3 px-2">
      <Switch 
        id="interview-mode" 
        checked={liveKit.interviewMode} 
        onCheckedChange={liveKit.toggleInterviewMode}
        className="data-[state=checked]:bg-primary shadow-[0_0_10px_rgba(0,255,255,0.4)]"
      />
      <div className="flex flex-col">
        <Label htmlFor="interview-mode" className="text-xs font-bold uppercase tracking-widest text-white/90 cursor-pointer">
          Interview
        </Label>
        <span className="text-[10px] uppercase font-mono tracking-wider text-white/50">
          {liveKit.interviewMode ? (
            <span className="text-primary drop-shadow-[0_0_5px_rgba(0,255,255,0.5)]">Voice ON</span>
          ) : (
            "Voice OFF"
          )}
        </span>
      </div>
    </div>
  );
}