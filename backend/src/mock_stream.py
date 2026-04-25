import asyncio
import json
import logging
from livekit.agents import JobContext

async def start_mock_fact_check_stream(ctx: JobContext, logger: logging.Logger):
    """
    Simulates the Backend 2 output pipeline by rotating through all possible verdict states.
    Publishes a dummy payload every 15 seconds to unblock frontend UI development.
    """
    
    # Array containing diverse examples covering all 4 verdict states
    mock_payloads = [
        {
            "type": "flag",
            "claim": "The global economy is actually projected to grow by 5.2% this year.",
            "verdict": "FALSE",
            "reasoning": "Global growth is projected at 3.1% according to the IMF.",
            "sources": ["https://www.imf.org/en/Publications/WEO"]
        },
        {
            "type": "flag",
            "claim": "Last year, for the first time in history, the United States became a net exporter of solar panels to the European Union.",
            "verdict": "TRUE",
            "reasoning": "US solar panel exports to the EU exceeded imports for the first time in 2023.",
            "sources": ["https://www.eia.gov/todayinenergy/"]
        },
        {
            "type": "flag",
            "claim": "Domestic oil production has increased by 20% since the start of the conflict.",
            "verdict": "PARTIALLY TRUE",
            "reasoning": "Production has increased, but only by 12%, not 20%.",
            "sources": ["https://www.eia.gov/dnav/pet/pet_crd_crpdn_adc_mbblpd_m.htm"]
        },
        {
            "type": "flag",
            "claim": "The new trade agreement will create 500,000 jobs in the manufacturing sector.",
            "verdict": "INCONCLUSIVE",
            "reasoning": "Economic projections vary widely, and no consensus exists on the exact job creation numbers.",
            "sources": []
        }
    ]

    payload_index = 0

    while True:
        # Yield control to the event loop for 15 seconds (Non-blocking)
        await asyncio.sleep(15)
        
        # Cycle to the next payload in the array
        current_payload = mock_payloads[payload_index]
        payload_index = (payload_index + 1) % len(mock_payloads)
        
        # Encode payload to bytes as required by LiveKit Data Channels
        encoded_payload = json.dumps(current_payload).encode("utf-8")
        
        # Await the publish action directly. 
        # (We don't need a separate asyncio.Task here because this entire while loop is running in a background task)
        await ctx.room.local_participant.publish_data(
            encoded_payload, reliable=True, topic="flag"
        )
        logger.info("Published mock fact-check flag: %s", current_payload["verdict"])