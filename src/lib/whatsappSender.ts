/**
 * WhatsApp Message Sender using 11za.in API
 */

const WHATSAPP_API_URL = "https://api.11za.in/apis/sendMessage/sendMessages";

export type SendMessageResult = {
    success: boolean;
    error?: string;
    response?: unknown;
};

/**
 * Send a text message via WhatsApp using 11za.in API
 */
export async function sendWhatsAppMessage(
    phoneNumber: string,
    message: string,
    authToken: string,
    originWebsite: string
): Promise<SendMessageResult> {
    try {
        if (!authToken || !originWebsite) {
            console.error("11za auth token and origin are required");
            return {
                success: false,
                error: "WhatsApp API credentials not provided",
            };
        }

        const payload = {
            sendto: phoneNumber,
            authToken: authToken,
            originWebsite: originWebsite,
            contentType: "text",
            text: message,
        };

        console.log(`Sending WhatsApp message to ${phoneNumber}...`);

        const response = await fetch(WHATSAPP_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("WhatsApp API error:", data);
            return {
                success: false,
                error: `WhatsApp API returned ${response.status}`,
                response: data,
            };
        }

        console.log("WhatsApp message sent successfully:", data);

        return {
            success: true,
            response: data,
        };
    } catch (error) {
        console.error("Error sending WhatsApp message:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}

/**
 * Send a template message via WhatsApp using 11za.in API
 * (For future use if you need template messages)
 */
export async function sendWhatsAppTemplate(
    phoneNumber: string,
    templateData: {
        templateId: string;
        parameters?: Record<string, string>;
    },
    authToken: string,
    originWebsite: string
): Promise<SendMessageResult> {
    try {
        if (!authToken || !originWebsite) {
            return {
                success: false,
                error: "WhatsApp API credentials not provided",
            };
        }

        const payload = {
            sendto: phoneNumber,
            authToken: authToken,
            originWebsite: originWebsite,
            templateId: templateData.templateId,
            parameters: templateData.parameters || {},
        };

        const response = await fetch("https://api.11za.in/apis/template/sendTemplate", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error("WhatsApp Template API error:", data);
            return {
                success: false,
                error: `WhatsApp API returned ${response.status}`,
                response: data,
            };
        }

        return {
            success: true,
            response: data,
        };
    } catch (error) {
        console.error("Error sending WhatsApp template:", error);
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
        };
    }
}
