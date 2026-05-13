import com.sun.net.httpserver.HttpServer;

import java.io.*;
import java.net.*;
import java.net.http.*;
import java.time.*;
import java.time.format.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

public class RconMonitor implements WebSocket.Listener {
    private static final String MGMT_HOST        = "localhost";
    private static final int    MGMT_PORT        = 25575;
    private static final String MGMT_SECRET      = "tPiEVVPAyVyoL6OEL3IZRdsBKYeMpPA4P8l7hoe3";
    private static final String NOTIFICATION_URL = "https://your-url-here";
    private static final int    POLL_INTERVAL    = 30; // seconds
    private static final int    HTTP_PORT        = 8080;

    private static final AtomicInteger currentPlayers   = new AtomicInteger(0);
    private static final HttpClient    http             = HttpClient.newHttpClient();
    private static volatile String     lastPollTime     = "never";
    private static volatile WebSocket                    ws;
    private static int                                   requestId = 1;
    private static volatile ScheduledExecutorService     poller;

    private final StringBuilder buffer = new StringBuilder();

    public static void main(String[] args) throws Exception {
        startHttpServer();
        connect();
        Thread.currentThread().join();
    }

    // --- WebSocket connection ---

    private static void connect() {
        System.out.println("Connecting to management server...");
        http.newWebSocketBuilder()
                .header("Authorization", "Bearer " + MGMT_SECRET)
                .buildAsync(URI.create("ws://" + MGMT_HOST + ":" + MGMT_PORT), new RconMonitor())
                .exceptionally(e -> {
                    System.err.println("Connection failed: " + e.getMessage() + ", retrying in 5s");
                    reconnectAfterDelay();
                    return null;
                });
    }

    private static void reconnectAfterDelay() {
        Executors.newSingleThreadScheduledExecutor()
                .schedule(RconMonitor::connect, 5, TimeUnit.SECONDS);
    }

    // --- WebSocket.Listener ---

    @Override
    public void onOpen(WebSocket webSocket) {
        ws = webSocket;
        System.out.println("Connected — polling every " + POLL_INTERVAL + "s");
        webSocket.request(1);
        startPolling();
    }

    @Override
    public CompletableFuture<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
        buffer.append(data);
        if (last) {
            handleMessage(buffer.toString());
            buffer.setLength(0);
        }
        webSocket.request(1);
        return null;
    }

    @Override
    public CompletableFuture<?> onClose(WebSocket webSocket, int statusCode, String reason) {
        System.out.println("Disconnected (" + reason + "), reconnecting...");
        reconnectAfterDelay();
        return null;
    }

    @Override
    public void onError(WebSocket webSocket, Throwable error) {
        System.err.println("WebSocket error: " + error.getMessage() + ", reconnecting...");
        reconnectAfterDelay();
    }

    // --- Polling ---

    private static void startPolling() {
        if (poller != null) poller.shutdownNow();
        poller = Executors.newSingleThreadScheduledExecutor();
        poller.scheduleAtFixedRate(() -> {
            try {
                sendRequest("minecraft:server/status", null);
            } catch (Exception e) {
                System.err.println("Poll error: " + e.getMessage());
            }
        }, 0, POLL_INTERVAL, TimeUnit.SECONDS);
    }

    private static void handleMessage(String message) {
        if (message.contains("\"result\"") && message.contains("\"started\"")) {
            int count = parsePlayerCount(message);
            currentPlayers.set(count);
            lastPollTime = timestamp();
            System.out.println("[" + lastPollTime + "] Players online: " + count);

            sendNotification(count);
        }
    }

    private static int parsePlayerCount(String json) {
        try {
            int start = json.indexOf("\"players\":[") + "\"players\":[".length();
            int end = json.indexOf("]", start);
            String players = json.substring(start, end).trim();
            if (players.isEmpty()) return 0;
            int count = 0;
            int idx = 0;
            while ((idx = players.indexOf("\"id\"", idx)) != -1) {
                count++;
                idx += 4;
            }
            return count;
        } catch (Exception e) {
            return 0;
        }
    }

    private static synchronized void sendRequest(String method, String params) {
        if (ws == null || ws.isOutputClosed()) {
            System.err.println("WebSocket unavailable, skipping: " + method);
            return;
        }
        String json = "{\"jsonrpc\":\"2.0\",\"method\":\"" + method + "\",\"id\":" + requestId++ +
                      (params != null ? ",\"params\":" + params : "") + "}";
        ws.sendText(json, true).exceptionally(e -> {
            System.err.println("Send failed: " + e.getMessage());
            return null;
        });
    }

    // --- Notification ---

    private static String timestamp() {
        return LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
    }

    private static void sendNotification(int playerCount) {
        String body = "{\"player_count\":" + playerCount + ",\"timestamp\":\"" + timestamp() + "\"}";
        HttpRequest req = HttpRequest.newBuilder()
                .uri(URI.create(NOTIFICATION_URL))
                .POST(HttpRequest.BodyPublishers.ofString(body))
                .header("Content-Type", "application/json")
                .build();
        http.sendAsync(req, HttpResponse.BodyHandlers.discarding())
                .thenRun(() -> System.out.println("Notification sent"))
                .exceptionally(e -> {
                    System.err.println("Notification failed: " + e.getMessage());
                    return null;
                });
    }

    // --- HTTP server ---

    private static void startHttpServer() throws IOException {
        HttpServer server = HttpServer.create(new InetSocketAddress(HTTP_PORT), 0);
        server.createContext("/status", exchange -> {
            if (!exchange.getRequestMethod().equalsIgnoreCase("POST")) {
                exchange.sendResponseHeaders(405, -1);
                return;
            }
            String body = "{\"player_count\":" + currentPlayers.get() + ",\"last_poll\":\"" + lastPollTime + "\"}";
            byte[] bytes = body.getBytes();
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, bytes.length);
            try (OutputStream os = exchange.getResponseBody()) {
                os.write(bytes);
            }
        });
        server.start();
        System.out.println("HTTP server on :" + HTTP_PORT);
    }
}
